import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMetadataFromFilename,
  validateAudioFile,
  validateMetadata,
  checkDuplicates,
  formatFileSize,
  MAX_FILE_SIZE_BYTES,
  MIN_FILE_SIZE_BYTES,
  MAX_METADATA_LENGTH,
} from '../src/utils/bulkImportHelpers.ts';

describe('Bulk Music Importer - Metadata Parsing', () => {
  test('correctly parses "Artist Name - Song Title.mp3" format', () => {
    const meta = parseMetadataFromFilename('Ludwig van Beethoven - Moonlight Sonata.mp3');
    assert.strictEqual(meta.artist, 'Ludwig van Beethoven');
    assert.strictEqual(meta.title, 'Moonlight Sonata');
  });

  test('handles filenames with multiple hyphens properly', () => {
    const meta = parseMetadataFromFilename('Pink Floyd - The Dark Side - Time.wav');
    assert.strictEqual(meta.artist, 'Pink Floyd');
    assert.strictEqual(meta.title, 'The Dark Side - Time');
  });

  test('falls back to "Unknown Artist" and filename when convention is not present', () => {
    const meta = parseMetadataFromFilename('clair_de_lune.flac');
    assert.strictEqual(meta.artist, 'Unknown Artist');
    assert.strictEqual(meta.title, 'clair_de_lune');
  });

  test('handles extensions with upper/mixed case', () => {
    const meta = parseMetadataFromFilename('Queen - Bohemian Rhapsody.WAV');
    assert.strictEqual(meta.artist, 'Queen');
    assert.strictEqual(meta.title, 'Bohemian Rhapsody');
  });
});

describe('Bulk Music Importer - Validation', () => {
  test('rejects empty title and artist', () => {
    assert.strictEqual(validateMetadata('', 'Valid Artist'), 'Song title cannot be empty.');
    assert.strictEqual(validateMetadata('   ', 'Valid Artist'), 'Song title cannot be empty.');
    assert.strictEqual(validateMetadata('Valid Title', ''), 'Artist name cannot be empty.');
  });

  test('rejects metadata exceeding PostgreSQL 255 character limit', () => {
    const longString = 'A'.repeat(256);
    assert.match(validateMetadata(longString, 'Artist') || '', /exceeds maximum length of 255/);
    assert.match(validateMetadata('Title', longString) || '', /exceeds maximum length of 255/);
  });

  test('accepts valid nonempty metadata', () => {
    assert.strictEqual(validateMetadata('Symphony No. 5', 'Beethoven'), null);
  });

  test('rejects empty files below 12 bytes', () => {
    const fakeFile = {
      name: 'empty.wav',
      size: 10,
      type: 'audio/wav',
    };
    const res = validateAudioFile(fakeFile);
    assert.strictEqual(res.isValid, false);
    assert.match(res.error || '', /insufficient audio bytes/);
  });

  test('rejects oversized files exceeding 25 MB limit', () => {
    const fakeFile = {
      name: 'huge_mix.wav',
      size: MAX_FILE_SIZE_BYTES + 1024,
      type: 'audio/wav',
    };
    const res = validateAudioFile(fakeFile);
    assert.strictEqual(res.isValid, false);
    assert.match(res.error || '', /exceeds maximum permitted limit of 25 MB/);
  });

  test('accepts supported audio formats (WAV, MP3, FLAC, OGG, M4A)', () => {
    for (const ext of ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.aiff', '.wma']) {
      const file = {
        name: `test${ext}`,
        size: 500_000,
        type: `audio/${ext.replace('.', '')}`,
      };
      const res = validateAudioFile(file);
      assert.strictEqual(res.isValid, true, `Should accept format ${ext}`);
    }
  });

  test('rejects unsupported extensions', () => {
    for (const ext of ['.exe', '.pdf', '.zip', '.txt', '.mp4v']) {
      const file = {
        name: `malicious${ext}`,
        size: 500_000,
        type: 'application/octet-stream',
      };
      const res = validateAudioFile(file);
      assert.strictEqual(res.isValid, false, `Should reject format ${ext}`);
      assert.match(res.error || '', /Unsupported file type/);
    }
  });
});

describe('Bulk Music Importer - Duplicate Detection', () => {
  const existingCatalog = [
    {
      id: 1,
      title: 'Yesterday',
      artist: 'The Beatles',
      durationMs: 125000,
      fingerprintCount: 820,
      createdAt: '2026-10-20T00:00:00Z',
    },
    {
      id: 2,
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      durationMs: 354000,
      fingerprintCount: 2400,
      createdAt: '2026-10-20T00:00:00Z',
    },
  ];

  test('flags tracks matching database catalog as catalog duplicates', () => {
    const batch = [
      {
        id: '1',
        file: { name: 'yesterday.mp3', size: 1000 },
        filename: 'yesterday.mp3',
        title: 'Yesterday',
        artist: 'The Beatles',
        size: 1000,
        status: 'ready',
        validationError: null,
        errorDetails: null,
        isDuplicate: false,
      },
    ];

    const result = checkDuplicates(batch, existingCatalog);
    assert.strictEqual(result[0].isDuplicate, true);
    assert.strictEqual(result[0].duplicateType, 'catalog');
  });

  test('flags multiple occurrences within the same batch as batch duplicates', () => {
    const batch = [
      {
        id: '1',
        file: { name: 'track1.mp3', size: 1000 },
        filename: 'track1.mp3',
        title: 'New Track',
        artist: 'New Artist',
        size: 1000,
        status: 'ready',
        validationError: null,
        errorDetails: null,
        isDuplicate: false,
      },
      {
        id: '2',
        file: { name: 'track1_copy.mp3', size: 1000 },
        filename: 'track1_copy.mp3',
        title: 'New Track',
        artist: 'New Artist',
        size: 1000,
        status: 'ready',
        validationError: null,
        errorDetails: null,
        isDuplicate: false,
      },
    ];

    const result = checkDuplicates(batch, existingCatalog);
    assert.strictEqual(result[0].isDuplicate, false); // first occurrence
    assert.strictEqual(result[1].isDuplicate, true); // duplicate occurrence
    assert.strictEqual(result[1].duplicateType, 'batch');
  });
});

describe('Bulk Music Importer - Formatting & Helpers', () => {
  test('formats byte counts accurately', () => {
    assert.strictEqual(formatFileSize(500), '500 B');
    assert.strictEqual(formatFileSize(2048), '2.0 KB');
    assert.strictEqual(formatFileSize(5_242_880), '5.00 MB');
  });
});
