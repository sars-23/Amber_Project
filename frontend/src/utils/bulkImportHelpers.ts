import type { Song } from '../types/api';

export const MAX_FILE_SIZE_BYTES = 26_214_400; // 25 MB
export const MIN_FILE_SIZE_BYTES = 12;
export const MAX_METADATA_LENGTH = 255;

export const SUPPORTED_AUDIO_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.m4a',
  '.aac',
  '.aiff',
  '.wma',
] as const;

export interface ParsedMetadata {
  title: string;
  artist: string;
  rawFilename: string;
}

export interface FileValidationResult {
  isValid: boolean;
  error: string | null;
}

export type QueueItemStatus =
  | 'ready'
  | 'queued'
  | 'indexing'
  | 'indexed'
  | 'failed'
  | 'skipped';

export interface BulkImportItem {
  id: string;
  file: File;
  filename: string;
  title: string;
  artist: string;
  size: number;
  status: QueueItemStatus;
  validationError: string | null;
  errorDetails: string | null;
  isDuplicate: boolean;
  duplicateType?: 'catalog' | 'batch';
  duplicateInfo?: string;
  fingerprintCount?: number;
  durationMs?: number;
}

/**
 * Strips supported audio extensions from a filename.
 */
export function stripExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0) return filename;
  return filename.substring(0, lastDot);
}

/**
 * Extracts the file extension in lowercase (e.g. '.mp3').
 */
export function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot < 0) return '';
  return filename.substring(lastDot).toLowerCase();
}

/**
 * Parses default Title and Artist from audio filename.
 * Convention: "Artist Name - Song Title.ext" -> Artist: "Artist Name", Title: "Song Title"
 * Otherwise: Title: filename without extension, Artist: "Unknown Artist"
 */
export function parseMetadataFromFilename(filename: string): ParsedMetadata {
  const baseName = stripExtension(filename).trim();

  // Check for standard "Artist - Title" separator
  if (baseName.includes(' - ')) {
    const parts = baseName.split(' - ');
    const artist = parts[0]?.trim() || 'Unknown Artist';
    const title = parts.slice(1).join(' - ').trim();
    if (title.length > 0) {
      return {
        title: title.slice(0, MAX_METADATA_LENGTH),
        artist: artist.slice(0, MAX_METADATA_LENGTH),
        rawFilename: filename,
      };
    }
  }

  // Fallback
  return {
    title: (baseName || 'Untitled Track').slice(0, MAX_METADATA_LENGTH),
    artist: 'Unknown Artist',
    rawFilename: filename,
  };
}

/**
 * Validates file size, extension, and supported audio constraints.
 */
export function validateAudioFile(file: File): FileValidationResult {
  if (!file) {
    return { isValid: false, error: 'File reference is missing' };
  }

  if (file.size < MIN_FILE_SIZE_BYTES) {
    return { isValid: false, error: 'File is empty or contains insufficient audio bytes (<12 bytes)' };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      isValid: false,
      error: `File size (${sizeMb} MB) exceeds maximum permitted limit of 25 MB`,
    };
  }

  const ext = getExtension(file.name);
  const hasValidExt = (SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(ext);
  const isAudioMime = file.type.startsWith('audio/') || file.type === 'application/ogg';

  if (!hasValidExt && !isAudioMime) {
    return {
      isValid: false,
      error: `Unsupported file type (${ext || 'unknown'}). Supported: WAV, MP3, FLAC, OGG, M4A, AAC, AIFF, WMA`,
    };
  }

  return { isValid: true, error: null };
}

/**
 * Validates metadata strings against non-empty and PostgreSQL length constraints.
 */
export function validateMetadata(title: string, artist: string): string | null {
  const trimmedTitle = title.trim();
  const trimmedArtist = artist.trim();

  if (!trimmedTitle) {
    return 'Song title cannot be empty.';
  }
  if (!trimmedArtist) {
    return 'Artist name cannot be empty.';
  }
  if (trimmedTitle.length > MAX_METADATA_LENGTH) {
    return `Song title exceeds maximum length of ${MAX_METADATA_LENGTH} characters.`;
  }
  if (trimmedArtist.length > MAX_METADATA_LENGTH) {
    return `Artist name exceeds maximum length of ${MAX_METADATA_LENGTH} characters.`;
  }

  return null;
}

/**
 * Generates a normalized comparison key for duplicate detection.
 */
export function getNormalizedKey(title: string, artist: string): string {
  return `${title.trim().toLowerCase()}:::${artist.trim().toLowerCase()}`;
}

/**
 * Formats byte counts into human-readable strings (KB / MB).
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Analyzes items against existing catalog songs and internal batch items to flag duplicates.
 */
export function checkDuplicates(
  items: BulkImportItem[],
  existingCatalog: Song[]
): BulkImportItem[] {
  const catalogKeys = new Set(
    existingCatalog.map((s) => getNormalizedKey(s.title, s.artist))
  );

  const batchKeyCounts = new Map<string, number>();
  for (const item of items) {
    const key = getNormalizedKey(item.title, item.artist);
    batchKeyCounts.set(key, (batchKeyCounts.get(key) || 0) + 1);
  }

  const seenBatchKeys = new Set<string>();

  return items.map((item) => {
    const key = getNormalizedKey(item.title, item.artist);

    if (catalogKeys.has(key)) {
      return {
        ...item,
        isDuplicate: true,
        duplicateType: 'catalog',
        duplicateInfo: 'Matches an existing track already in the database catalog',
      };
    }

    if ((batchKeyCounts.get(key) || 0) > 1) {
      const isSubsequent = seenBatchKeys.has(key);
      seenBatchKeys.add(key);
      if (isSubsequent) {
        return {
          ...item,
          isDuplicate: true,
          duplicateType: 'batch',
          duplicateInfo: 'Duplicate of another track in this import queue',
        };
      }
    }

    return {
      ...item,
      isDuplicate: false,
      duplicateType: undefined,
      duplicateInfo: undefined,
    };
  });
}
