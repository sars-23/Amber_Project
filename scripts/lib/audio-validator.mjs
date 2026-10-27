import fs from 'node:fs';
import path from 'node:path';

export const SUPPORTED_EXTENSIONS = new Set([
  '.wav',
  '.mp3',
  '.flac',
  '.ogg',
  '.m4a',
  '.aac',
  '.opus',
  '.wma',
  '.aiff'
]);

export const MIN_FILE_SIZE_BYTES = 12;
export const MAX_FILE_SIZE_BYTES = 26_214_400; // 25 MB (matches AudioProperties.java)
export const MAX_METADATA_LENGTH = 255; // Matches PostgreSQL VARCHAR(255) schema

/**
 * Validates audio file path, preventing directory traversal.
 *
 * @param {string} baseDir - The root audio directory
 * @param {string} relativePath - Relative path supplied in manifest
 * @returns {{ valid: boolean, fullPath?: string, error?: string }}
 */
export function validateAudioPath(baseDir, relativePath) {
  if (!baseDir || typeof baseDir !== 'string') {
    return { valid: false, error: 'Base audio directory path must be provided' };
  }
  if (!relativePath || typeof relativePath !== 'string') {
    return { valid: false, error: 'Relative path is missing or empty' };
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, relativePath);

  // Path traversal check
  // Check that resolvedTarget starts with resolvedBase + path separator
  const baseWithSep = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;
  if (!resolvedTarget.startsWith(baseWithSep) && resolvedTarget !== resolvedBase) {
    return {
      valid: false,
      error: `Path traversal detected: '${relativePath}' escapes audio directory '${baseDir}'`
    };
  }

  // File existence check
  if (!fs.existsSync(resolvedTarget)) {
    return {
      valid: false,
      fullPath: resolvedTarget,
      error: `Audio file does not exist: '${resolvedTarget}'`
    };
  }

  let stat;
  try {
    stat = fs.statSync(resolvedTarget);
  } catch (err) {
    return {
      valid: false,
      fullPath: resolvedTarget,
      error: `Failed to stat audio file: ${err.message}`
    };
  }

  if (!stat.isFile()) {
    return {
      valid: false,
      fullPath: resolvedTarget,
      error: `Path is not a regular file: '${resolvedTarget}'`
    };
  }

  // Extension check
  const ext = path.extname(resolvedTarget).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      fullPath: resolvedTarget,
      sizeBytes: stat.size,
      error: `Unsupported audio extension '${ext}'. Allowed: ${Array.from(SUPPORTED_EXTENSIONS).join(', ')}`
    };
  }

  // Size check
  if (stat.size < MIN_FILE_SIZE_BYTES) {
    return {
      valid: false,
      fullPath: resolvedTarget,
      sizeBytes: stat.size,
      error: `File is too small (${stat.size} bytes). Minimum required is ${MIN_FILE_SIZE_BYTES} bytes.`
    };
  }

  if (stat.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      fullPath: resolvedTarget,
      sizeBytes: stat.size,
      error: `File exceeds maximum allowed size of 25 MB (${(stat.size / 1_048_576).toFixed(2)} MB).`
    };
  }

  return {
    valid: true,
    fullPath: resolvedTarget,
    sizeBytes: stat.size,
    extension: ext
  };
}

/**
 * Validates track metadata (title and artist).
 *
 * @param {string} title
 * @param {string} artist
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateMetadata(title, artist) {
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return { valid: false, error: 'Track title is required and cannot be empty.' };
  }
  if (!artist || typeof artist !== 'string' || artist.trim().length === 0) {
    return { valid: false, error: 'Track artist is required and cannot be empty.' };
  }

  if (title.trim().length > MAX_METADATA_LENGTH) {
    return {
      valid: false,
      error: `Title exceeds maximum limit of ${MAX_METADATA_LENGTH} characters (length: ${title.trim().length}).`
    };
  }

  if (artist.trim().length > MAX_METADATA_LENGTH) {
    return {
      valid: false,
      error: `Artist exceeds maximum limit of ${MAX_METADATA_LENGTH} characters (length: ${artist.trim().length}).`
    };
  }

  return { valid: true };
}

/**
 * Normalizes title and artist for duplicate comparisons.
 *
 * @param {string} title
 * @param {string} artist
 * @returns {string} e.g. "queen|bohemianrhapsody"
 */
export function normalizeTrackKey(title, artist) {
  const normTitle = (title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]/g, '');

  const normArtist = (artist || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

  return `${normArtist}|${normTitle}`;
}
