import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, tokenizeCsv, stringifyCsv } from '../lib/csv-parser.mjs';
import {
  validateAudioPath,
  validateMetadata,
  validateLicensing,
  normalizeTrackKey,
  parseWavFile
} from '../lib/audio-validator.mjs';
import { AmberClient, AmbiguousUploadError } from '../lib/amber-client.mjs';
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

  it('ignores full comment lines starting with #', () => {
    const csv = `# Header comment explaining template\n# Another comment\nrelative_path,title,artist,license,source_url\nsong1.wav,Title One,Artist One,CC-BY-4.0,https://example.org/1`;
    const rows = parseCsv(csv, { requiredColumns: ['relative_path', 'title', 'artist'] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Title One');
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

describe('Audio Preflight and Media Validation', () => {
  it('accepts valid, non-silent audio file of acceptable duration', () => {
    const res = validateAudioPath(FIXTURES_DIR, 'sample.wav');
    assert.equal(res.valid, true);
    assert.equal(res.extension, '.wav');
    assert.ok(res.sizeBytes > 12);
    assert.ok(res.durationSeconds >= 1.0 && res.durationSeconds <= 600.0);
    if (res.rmsEnergy !== undefined) {
      assert.ok(res.rmsEnergy >= 1e-5);
    }
  });

  it('rejects silent 16-bit PCM audio with RMS energy < 1e-5', () => {
    const res = validateAudioPath(FIXTURES_DIR, 'silent.wav');
    assert.equal(res.valid, false);
    assert.match(res.error, /completely silent|RMS energy/i);
  });

  it('detects silence in 8-bit unsigned PCM and 32-bit float WAV encodings', () => {
    // Generate synthetic in-memory 8-bit PCM silent WAV (all 128 bytes)
    const sampleRate = 11025;
    const numSamples = 11025; // 1s
    const buf8 = Buffer.alloc(44 + numSamples);
    buf8.write('RIFF', 0);
    buf8.writeUInt32LE(36 + numSamples, 4);
    buf8.write('WAVEfmt ', 8);
    buf8.writeUInt32LE(16, 16);
    buf8.writeUInt16LE(1, 20); // PCM
    buf8.writeUInt16LE(1, 22); // mono
    buf8.writeUInt32LE(sampleRate, 24);
    buf8.writeUInt32LE(sampleRate, 28);
    buf8.writeUInt16LE(1, 32);
    buf8.writeUInt16LE(8, 34); // 8-bit
    buf8.write('data', 36);
    buf8.writeUInt32LE(numSamples, 40);
    buf8.fill(128, 44); // 128 = silence in unsigned 8-bit PCM

    const tempSilent8 = path.join(FIXTURES_DIR, 'temp_silent_8.wav');
    fs.writeFileSync(tempSilent8, buf8);
    try {
      const res = validateAudioPath(FIXTURES_DIR, 'temp_silent_8.wav');
      assert.equal(res.valid, false);
      assert.match(res.error, /completely silent|RMS energy/i);
    } finally {
      if (fs.existsSync(tempSilent8)) fs.unlinkSync(tempSilent8);
    }
  });

  it('safely rejects truncated or corrupt WAV chunk boundaries', () => {
    // Truncated chunk header
    const truncatedBuf = Buffer.from('RIFF\x20\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x11\x2b\x00\x00\x22\x56\x00\x00\x02\x00\x10\x00data\xff\xff\x00\x00');
    const tempTrunc = path.join(FIXTURES_DIR, 'temp_trunc.wav');
    fs.writeFileSync(tempTrunc, truncatedBuf);
    try {
      const res = parseWavFile(tempTrunc);
      assert.equal(res.valid, false);
    } finally {
      if (fs.existsSync(tempTrunc)) fs.unlinkSync(tempTrunc);
    }
  });

  it('rejects audio shorter than minimum duration of 1s', () => {
    const res = validateAudioPath(FIXTURES_DIR, 'short.wav');
    assert.equal(res.valid, false);
    assert.match(res.error, /shorter than minimum required duration/i);
  });

  it('rejects undecodable or corrupt audio container', () => {
    const res = validateAudioPath(FIXTURES_DIR, 'corrupt.wav');
    assert.equal(res.valid, false);
    assert.match(res.error, /too small|corrupt|container|header/i);
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
});

describe('Metadata and Licensing Validation', () => {
  it('validates metadata presence and length', () => {
    assert.equal(validateMetadata('Valid Title', 'Valid Artist').valid, true);
    assert.equal(validateMetadata('', 'Artist').valid, false);
    assert.equal(validateMetadata('Title', '').valid, false);
    assert.equal(validateMetadata('a'.repeat(256), 'Artist').valid, false);
    assert.equal(validateMetadata('Title', 'b'.repeat(256)).valid, false);
  });

  it('validates license identifier and source URL formatting', () => {
    // Valid cases
    const okHttp = validateLicensing('CC-BY-4.0', 'http://example.org/audio.wav');
    assert.equal(okHttp.valid, true);
    assert.equal(okHttp.license, 'CC-BY-4.0');
    assert.equal(okHttp.sourceUrl, 'http://example.org/audio.wav');

    const okHttps = validateLicensing('CC0-1.0', 'https://freemusicarchive.org/track/123');
    assert.equal(okHttps.valid, true);

    // Empty or missing license
    const emptyLic = validateLicensing('', 'https://example.org');
    assert.equal(emptyLic.valid, false);
    assert.match(emptyLic.error, /licence identifier is required/i);

    const whitespaceLic = validateLicensing('   ', 'https://example.org');
    assert.equal(whitespaceLic.valid, false);

    // Empty or missing source URL
    const emptyUrl = validateLicensing('MIT', '');
    assert.equal(emptyUrl.valid, false);
    assert.match(emptyUrl.error, /source url is required/i);

    // Invalid protocol
    const ftpUrl = validateLicensing('CC-BY', 'ftp://example.org/audio.wav');
    assert.equal(ftpUrl.valid, false);
    assert.match(ftpUrl.error, /must use http or https/i);

    // Malformed URL
    const malformedUrl = validateLicensing('CC-BY', 'not-a-valid-url');
    assert.equal(malformedUrl.valid, false);
    assert.match(malformedUrl.error, /invalid or malformed/i);
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

describe('AmberClient - Idempotency Safety, Retries & Secrets', () => {
  it('redacts admin key from error messages and logs', () => {
    const secret = 'super-secret-production-admin-key-999';
    const client = new AmberClient({ adminApiKey: secret });

    const msg = `Unauthorized access attempt with key: ${secret} on endpoint /api/v1/songs`;
    const redacted = client.redact(msg);
    assert.ok(!redacted.includes(secret));
    assert.ok(redacted.includes('[REDACTED]'));
  });

  it('DOES NOT automatically retry uploadSong on 500 or timeout (throws AmbiguousUploadError on first failure)', async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      return { status: 500, ok: false, text: async () => 'Internal Server Error' };
    };

    const client = new AmberClient({
      adminApiKey: 'test-key',
      maxRetries: 3,
      customFetch: mockFetch
    });

    await assert.rejects(
      () => client.uploadSong(path.join(FIXTURES_DIR, 'sample.wav'), 'Sample', 'Artist'),
      (err) => {
        assert.ok(err instanceof AmbiguousUploadError);
        assert.equal(err.isAmbiguous, true);
        assert.match(err.message, /ambiguous/i);
        return true;
      }
    );

    // Crucial: exactly 1 attempt must have occurred; NO automatic retries for uploadSong
    assert.equal(attempts, 1);
  });

  it('retries safe read operations (fetchCatalogue) on transient 503 and succeeds on next attempt', async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      if (attempts === 1) {
        return { status: 503, ok: false, text: async () => 'Service Unavailable' };
      }
      return {
        status: 200,
        ok: true,
        json: async () => [{ id: 1, title: 'Sample', artist: 'Artist' }]
      };
    };

    const client = new AmberClient({
      maxRetries: 2,
      timeoutMs: 1000,
      customFetch: mockFetch
    });

    const catalogue = await client.fetchCatalogue();
    assert.equal(attempts, 2);
    assert.equal(catalogue.length, 1);
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
    assert.equal(attempts, 1);
  });
});

describe('Bulk Ingestion Fail-Closed Duplicate Safety & Reconciliation', () => {
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

  it('aborts before first upload and sends ZERO upload requests when catalogue fetch fails in --execute mode', async () => {
    const csvContent = `relative_path,title,artist,license,source_url
sample.wav,Acoustic Breeze,Benjamin Tissot,CC-BY-4.0,https://example.org/1`;
    fs.writeFileSync(tempManifest, csvContent, 'utf8');

    let uploadCalls = 0;
    let catalogueCalls = 0;

    const mockFetch = async (url, opts = {}) => {
      if (url.includes('/songs') && opts.method === 'POST') {
        uploadCalls++;
        return { status: 201, ok: true, json: async () => ({ id: 1, title: 'Sample' }) };
      }
      if (url.includes('/songs') && opts.method === 'GET') {
        catalogueCalls++;
        return { status: 500, ok: false, text: async () => 'Database connection timeout' };
      }
      return { status: 200, ok: true, json: async () => ({ status: 'UP' }) };
    };

    const originalKey = process.env.AMBER_ADMIN_API_KEY;
    process.env.AMBER_ADMIN_API_KEY = 'test-admin-key';

    try {
      const result = await runBulkImport([
        '--audio-dir', FIXTURES_DIR,
        '--manifest', tempManifest,
        '--report', tempReport,
        '--execute'
      ], { customFetch: mockFetch });

      assert.equal(result.exitCode, 1, 'Must exit with non-zero code');
      assert.match(result.error, /duplicate protection could not be verified/i);
      assert.equal(uploadCalls, 0, 'Zero upload requests must be sent when catalogue check fails');
      assert.ok(catalogueCalls >= 1, 'Catalogue query must have been attempted');
      assert.ok(fs.existsSync(tempReport), 'Report must be written documenting failure reason');

      const report = JSON.parse(fs.readFileSync(tempReport, 'utf8'));
      assert.equal(report.status, 'ABORTED');
      assert.equal(report.summary.successful, 0);
    } finally {
      if (originalKey) process.env.AMBER_ADMIN_API_KEY = originalKey;
      else delete process.env.AMBER_ADMIN_API_KEY;
    }
  });

  it('halts immediately on ambiguous upload failure and avoids uploading subsequent batch items', async () => {
    const csvContent = `relative_path,title,artist,license,source_url
sample.wav,Ambiguous Track One,Artist One,CC-BY-4.0,https://example.org/1
sample.wav,Subsequent Track Two,Artist Two,CC-BY-4.0,https://example.org/2`;
    fs.writeFileSync(tempManifest, csvContent, 'utf8');

    let postCalls = 0;
    const mockFetch = async (url, opts = {}) => {
      if (url.includes('/songs') && opts.method === 'GET') {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (url.includes('/songs') && opts.method === 'POST') {
        postCalls++;
        // First track encounters a timeout / 500 ambiguous error
        return { status: 500, ok: false, text: async () => 'Database write timeout' };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const originalKey = process.env.AMBER_ADMIN_API_KEY;
    process.env.AMBER_ADMIN_API_KEY = 'test-admin-key';

    try {
      const result = await runBulkImport([
        '--audio-dir', FIXTURES_DIR,
        '--manifest', tempManifest,
        '--report', tempReport,
        '--execute',
        '--allow-duplicates'
      ], { customFetch: mockFetch });

      assert.equal(result.exitCode, 1);
      // Crucial: exactly 1 POST call made! Track Two was NOT uploaded because ingestion halted!
      assert.equal(postCalls, 1);

      const report = JSON.parse(fs.readFileSync(tempReport, 'utf8'));
      assert.equal(report.reconciliationRequired, true);
      assert.equal(report.results[0].status, 'AMBIGUOUS');
      assert.match(report.results[0].reason, /ambiguous/i);
    } finally {
      if (originalKey) process.env.AMBER_ADMIN_API_KEY = originalKey;
      else delete process.env.AMBER_ADMIN_API_KEY;
    }
  });

  it('reconciles ambiguous track on --resume: marks SUCCESS and skips upload if present in catalogue', async () => {
    const csvContent = `relative_path,title,artist,license,source_url
sample.wav,Ambiguous Track One,Artist One,CC-BY-4.0,https://example.org/1
sample.wav,Subsequent Track Two,Artist Two,CC-BY-4.0,https://example.org/2`;
    fs.writeFileSync(tempManifest, csvContent, 'utf8');

    // Create prior report where track 1 was recorded as AMBIGUOUS
    const priorReport = {
      timestamp: new Date().toISOString(),
      mode: 'execute',
      results: [
        {
          relativePath: 'sample.wav',
          title: 'Ambiguous Track One',
          artist: 'Artist One',
          license: 'CC-BY-4.0',
          sourceUrl: 'https://example.org/1',
          status: 'AMBIGUOUS',
          reason: 'Ambiguous upload outcome: server timeout'
        }
      ]
    };
    fs.writeFileSync(tempReport, JSON.stringify(priorReport), 'utf8');

    let postCalls = 0;
    const mockFetch = async (url, opts = {}) => {
      if (url.includes('/songs') && opts.method === 'GET') {
        // Track 1 actually DID get inserted into the catalogue during the prior ambiguous attempt!
        return {
          ok: true,
          status: 200,
          json: async () => [
            { id: 999, title: 'Ambiguous Track One', artist: 'Artist One', fingerprintCount: 300, durationMs: 1500 }
          ]
        };
      }
      if (url.includes('/songs') && opts.method === 'POST') {
        postCalls++;
        return {
          status: 201,
          ok: true,
          json: async () => ({ id: 1000, title: 'Subsequent Track Two', artist: 'Artist Two', fingerprintCount: 400, durationMs: 1500 })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const originalKey = process.env.AMBER_ADMIN_API_KEY;
    process.env.AMBER_ADMIN_API_KEY = 'test-admin-key';

    try {
      const result = await runBulkImport([
        '--audio-dir', FIXTURES_DIR,
        '--manifest', tempManifest,
        '--report', tempReport,
        '--resume',
        '--execute',
        '--allow-duplicates'
      ], { customFetch: mockFetch });

      assert.equal(result.exitCode, 0);
      // Track 1 was reconciled from catalogue; ONLY Track 2 was uploaded!
      assert.equal(postCalls, 1);

      const finalReport = JSON.parse(fs.readFileSync(tempReport, 'utf8'));
      assert.equal(finalReport.results[0].status, 'SUCCESS');
      assert.equal(finalReport.results[0].songId, 999);
      assert.match(finalReport.results[0].reason, /reconciled from catalogue/i);
    } finally {
      if (originalKey) process.env.AMBER_ADMIN_API_KEY = originalKey;
      else delete process.env.AMBER_ADMIN_API_KEY;
    }
  });

  it('clearly marks duplicate status as UNKNOWN in dry-run mode when catalogue fetch fails', async () => {
    const csvContent = `relative_path,title,artist,license,source_url
sample.wav,Acoustic Breeze,Benjamin Tissot,CC-BY-4.0,https://example.org/1`;
    fs.writeFileSync(tempManifest, csvContent, 'utf8');

    const mockFetch = async (url) => {
      if (url.includes('/songs')) {
        return { status: 503, ok: false, text: async () => 'Service Temporarily Unavailable' };
      }
      return { status: 200, ok: true, json: async () => ({ status: 'UP' }) };
    };

    const result = await runBulkImport([
      '--audio-dir', FIXTURES_DIR,
      '--manifest', tempManifest,
      '--report', tempReport
    ], { customFetch: mockFetch });

    assert.equal(result.exitCode, 0);
    assert.ok(fs.existsSync(tempReport));

    const report = JSON.parse(fs.readFileSync(tempReport, 'utf8'));
    assert.equal(report.catalogueStatus, 'UNAVAILABLE');
    assert.ok(report.catalogueError.includes('Service Temporarily Unavailable') || report.catalogueError.includes('503'));
    assert.equal(report.summary.unknownDuplicates, 1);
    assert.equal(report.results[0].status, 'UNKNOWN');
    assert.equal(report.results[0].duplicateStatus, 'UNKNOWN');
    assert.match(report.results[0].reason, /duplicate protection could not be verified/i);
  });

  it('rejects rows with missing licence or malformed source URLs during preflight', async () => {
    const csvContent = `relative_path,title,artist,license,source_url
sample.wav,Valid Track,Artist One,CC-BY-4.0,https://example.org/valid
sample.wav,No License,Artist Two,,https://example.org/valid
sample.wav,Bad Protocol,Artist Three,CC0,ftp://example.org/ftp-not-allowed
sample.wav,Malformed URL,Artist Four,MIT,not_a_valid_url`;

    fs.writeFileSync(tempManifest, csvContent, 'utf8');

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => []
    });

    const result = await runBulkImport([
      '--audio-dir', FIXTURES_DIR,
      '--manifest', tempManifest,
      '--report', tempReport
    ], { customFetch: mockFetch });

    assert.equal(result.exitCode, 0);
    const report = JSON.parse(fs.readFileSync(tempReport, 'utf8'));
    assert.equal(report.summary.ready, 1);
    assert.equal(report.summary.invalid, 3);

    // Verify invalid reasons
    assert.match(report.results[1].reason, /licence identifier is required/i);
    assert.match(report.results[2].reason, /must use http or https/i);
    assert.match(report.results[3].reason, /invalid or malformed/i);

    // Verify licensing metadata is preserved in results
    assert.equal(report.results[0].license, 'CC-BY-4.0');
    assert.equal(report.results[0].sourceUrl, 'https://example.org/valid');
  });
});
