import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, tokenizeCsv, stringifyCsv } from '../lib/csv-parser.mjs';
import { validateAudioPath, validateMetadata, normalizeTrackKey } from '../lib/audio-validator.mjs';
import { AmberClient } from '../lib/amber-client.mjs';
import { runBulkImport } from '../bulk-import.mjs';

const FIXTURES_DIR = path.resolve('scripts/test/fixtures');

describe('CSV Parser', () => {
  it('parses standard CSV with headers', () => {
    const csv = `relative_path,title,artist,license,source_url\r\nsong1.wav,Title One,Artist One,CC-BY-4.0,https://example.org/1`;
    const rows = parseCsv(csv, { requiredColumns: ['relative_path', 'title', 'artist'] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].relative_path, 'song1.wav');
    assert.equal(rows[0].title, 'Title One');
    assert.equal(rows[0].artist, 'Artist One');
    assert.equal(rows[0].license, 'CC-BY-4.0');
    assert.equal(rows[0].source_url, 'https://example.org/1');
  });

  it('handles quoted fields with commas and escaped quotes', () => {
    const csv = `relative_path,title,artist,license,source_url\n"songs/a,b.wav","Rock, Paper & ""Scissors""","The Band",CC0,"http://example.org"`;
    const rows = parseCsv(csv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].relative_path, 'songs/a,b.wav');
    assert.equal(rows[0].title, 'Rock, Paper & "Scissors"');
    assert.equal(rows[0].artist, 'The Band');
  });

  it('throws when required columns are missing', () => {
    const csv = `filename,track_name\nsong.wav,Sample Track`;
    assert.throws(
      () => parseCsv(csv, { requiredColumns: ['relative_path', 'title', 'artist'] }),
      /missing required column/i
    );
  });

  it('serializes records to valid RFC-4180 CSV', () => {
    const data = [
      { id: 1, name: 'Song, A', desc: 'Contains "quotes"' },
      { id: 2, name: 'Song B', desc: 'Simple' }
    ];
    const out = stringifyCsv(data, ['id', 'name', 'desc']);
    assert.match(out, /"Song, A"/);
    assert.match(out, /"Contains ""quotes"""/);
  });
});

describe('Audio and Metadata Validation', () => {
  it('accepts valid audio file inside directory', () => {
    const res = validateAudioPath(FIXTURES_DIR, 'sample.wav');
    assert.equal(res.valid, true);
    assert.equal(res.extension, '.wav');
    assert.ok(res.sizeBytes > 12);
  });

  it('prevents path traversal attempts', () => {
    const res = validateAudioPath(FIXTURES_DIR, '../../secret.wav');
    assert.equal(res.valid, false);
    assert.match(res.error, /path traversal detected/i);
  });

  it('rejects nonexistent files', () => {
    const res = validateAudioPath(FIXTURES_DIR, 'does_not_exist.wav');
    assert.equal(res.valid, false);
    assert.match(res.error, /does not exist/i);
  });

  it('rejects unsupported audio extensions', () => {
    const res = validateAudioPath(FIXTURES_DIR, 'sample.txt');
    assert.equal(res.valid, false);
    assert.match(res.error, /unsupported audio extension/i);
  });

  it('rejects files smaller than minimum size limit', () => {
    const res = validateAudioPath(FIXTURES_DIR, 'tiny.wav');
    assert.equal(res.valid, false);
    assert.match(res.error, /too small/i);
  });

  it('validates metadata presence and length', () => {
    assert.equal(validateMetadata('Valid Title', 'Valid Artist').valid, true);
    assert.equal(validateMetadata('', 'Artist').valid, false);
    assert.equal(validateMetadata('Title', '').valid, false);
    assert.equal(validateMetadata('a'.repeat(256), 'Artist').valid, false);
    assert.equal(validateMetadata('Title', 'b'.repeat(256)).valid, false);
  });

  it('normalizes titles and artists for duplicate matching', () => {
    const key1 = normalizeTrackKey('Bohemian Rhapsody', 'Queen');
    const key2 = normalizeTrackKey('  bohemian rhapsody! ', ' QUEEN ');
    const key3 = normalizeTrackKey('Bohémian Rhâpsody', 'Queen');
    assert.equal(key1, 'queen|bohemianrhapsody');
    assert.equal(key1, key2);
    assert.equal(key1, key3);
  });
});

describe('AmberClient - Secrets, Pagination & Retries', () => {
  it('redacts admin key from error messages and logs', () => {
    const secret = 'super-secret-production-admin-key-999';
    const client = new AmberClient({ adminApiKey: secret });

    const msg = `Unauthorized access attempt with key: ${secret} on endpoint /api/v1/songs`;
    const redacted = client.redact(msg);
    assert.ok(!redacted.includes(secret));
    assert.ok(redacted.includes('[REDACTED]'));
  });

  it('paginates through catalogue results until exhausted', async () => {
    const page0 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, title: `Song ${i + 1}`, artist: 'Artist' }));
    const page1 = Array.from({ length: 25 }, (_, i) => ({ id: i + 101, title: `Song ${i + 101}`, artist: 'Artist' }));

    let callCount = 0;
    const mockFetch = async (url) => {
      callCount++;
      if (url.includes('page=0')) {
        return { ok: true, status: 200, json: async () => page0 };
      }
      if (url.includes('page=1')) {
        return { ok: true, status: 200, json: async () => page1 };
      }
      return { ok: true, status: 200, json: async () => [] };
    };

    const client = new AmberClient({ customFetch: mockFetch });
    const catalogue = await client.fetchCatalogue();

    assert.equal(callCount, 2);
    assert.equal(catalogue.length, 125);
    assert.equal(catalogue[0].id, 1);
    assert.equal(catalogue[124].id, 125);
  });

  it('retries on transient 503 and succeeds on next attempt', async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      if (attempts === 1) {
        return { status: 503, ok: false, text: async () => 'Service Unavailable' };
      }
      return {
        status: 201,
        ok: true,
        json: async () => ({ id: 42, title: 'Sample', artist: 'Artist', fingerprintCount: 150 })
      };
    };

    const client = new AmberClient({
      adminApiKey: 'test-key',
      maxRetries: 2,
      timeoutMs: 1000,
      customFetch: mockFetch
    });

    const res = await client.uploadSong(path.join(FIXTURES_DIR, 'sample.wav'), 'Sample', 'Artist');
    assert.equal(attempts, 2);
    assert.equal(res.id, 42);
  });

  it('fails immediately without retrying on 401 Unauthorized', async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      return { status: 401, ok: false, text: async () => 'Invalid credentials' };
    };

    const client = new AmberClient({
      adminApiKey: 'wrong-key',
      maxRetries: 3,
      customFetch: mockFetch
    });

    await assert.rejects(
      () => client.uploadSong(path.join(FIXTURES_DIR, 'sample.wav'), 'Sample', 'Artist'),
      /HTTP 401 Unauthorized/
    );
    assert.equal(attempts, 1); // No retries on 401
  });
});

describe('Bulk Ingestion CLI End-to-End', () => {
  const tempDir = path.resolve('scripts/test/temp_bulk');
  const tempManifest = path.join(tempDir, 'manifest.csv');
  const tempReport = path.join(tempDir, 'report.json');

  beforeEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('performs safe dry run without --execute and generates report', async () => {
    const csvContent = `relative_path,title,artist,license,source_url
sample.wav,Acoustic Breeze,Benjamin Tissot,CC-BY-4.0,https://example.org/1
sample.txt,Unsupported Track,Unknown,CC0,https://example.org/2
../../traversal.wav,Hacker Track,Unknown,CC0,https://example.org/3`;

    fs.writeFileSync(tempManifest, csvContent, 'utf8');

    const result = await runBulkImport([
      '--audio-dir', FIXTURES_DIR,
      '--manifest', tempManifest,
      '--report', tempReport
    ]);

    assert.equal(result.exitCode, 0);
    assert.ok(fs.existsSync(tempReport));

    const report = JSON.parse(fs.readFileSync(tempReport, 'utf8'));
    assert.equal(report.mode, 'dry-run');
    assert.equal(report.summary.total, 3);
    assert.equal(report.summary.ready, 1);
    assert.equal(report.summary.invalid, 2);
  });

  it('enforces AMBER_ADMIN_API_KEY when running with --execute', async () => {
    const csvContent = `relative_path,title,artist,license,source_url
sample.wav,Acoustic Breeze,Benjamin Tissot,CC-BY-4.0,https://example.org/1`;

    fs.writeFileSync(tempManifest, csvContent, 'utf8');

    const originalKey = process.env.AMBER_ADMIN_API_KEY;
    delete process.env.AMBER_ADMIN_API_KEY;

    try {
      const result = await runBulkImport([
        '--audio-dir', FIXTURES_DIR,
        '--manifest', tempManifest,
        '--report', tempReport,
        '--execute'
      ]);
      assert.equal(result.exitCode, 1);
    } finally {
      if (originalKey) process.env.AMBER_ADMIN_API_KEY = originalKey;
    }
  });
});
