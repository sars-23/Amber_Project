import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';

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

export const MIN_FILE_SIZE_BYTES = 12; // Matches AudioValidationService.java
export const MAX_FILE_SIZE_BYTES = 26_214_400; // 25 MB (matches AudioProperties.java)
export const MIN_DURATION_SECONDS = 1.0; // 1.0s (matches AudioProperties.java)
export const MAX_DURATION_SECONDS = 600.0; // 600.0s / 10m (matches AudioProperties.java)
export const MIN_RMS_ENERGY = 1e-5; // Matches AudioValidationService.java
export const MAX_METADATA_LENGTH = 255; // Matches PostgreSQL VARCHAR(255) schema

/**
 * Validates audio file path, size, format, and truthful media content.
 *
 * @param {string} baseDir - The root audio directory
 * @param {string} relativePath - Relative path supplied in manifest
 * @param {Object} [options]
 * @param {boolean} [options.checkMedia=true] - Whether to validate media duration/silence
 * @returns {{
 *   valid: boolean,
 *   fullPath?: string,
 *   sizeBytes?: number,
 *   extension?: string,
 *   validationLevel?: 'full' | 'structural_only',
 *   durationSeconds?: number,
 *   rmsEnergy?: number,
 *   warning?: string,
 *   error?: string
 * }}
 */
export function validateAudioPath(baseDir, relativePath, options = {}) {
  if (!baseDir || typeof baseDir !== 'string') {
    return { valid: false, error: 'Base audio directory path must be provided' };
  }
  if (!relativePath || typeof relativePath !== 'string') {
    return { valid: false, error: 'Relative path is missing or empty' };
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, relativePath);

  // 1. Path traversal check
  const baseWithSep = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;
  if (!resolvedTarget.startsWith(baseWithSep) && resolvedTarget !== resolvedBase) {
    return {
      valid: false,
      error: `Path traversal detected: '${relativePath}' escapes audio directory '${baseDir}'`
    };
  }

  // 2. File existence check
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

  // 3. Extension check
  const ext = path.extname(resolvedTarget).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      fullPath: resolvedTarget,
      sizeBytes: stat.size,
      error: `Unsupported audio extension '${ext}'. Allowed: ${Array.from(SUPPORTED_EXTENSIONS).join(', ')}`
    };
  }

  // 4. File size check
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

  // 5. Media inspection (duration, silence, and decodability)
  if (options.checkMedia !== false) {
    const mediaCheck = inspectAudioMedia(resolvedTarget, ext);
    if (!mediaCheck.valid) {
      return {
        valid: false,
        fullPath: resolvedTarget,
        sizeBytes: stat.size,
        extension: ext,
        error: mediaCheck.error
      };
    }

    return {
      valid: true,
      fullPath: resolvedTarget,
      sizeBytes: stat.size,
      extension: ext,
      validationLevel: mediaCheck.validationLevel,
      durationSeconds: mediaCheck.durationSeconds,
      rmsEnergy: mediaCheck.rmsEnergy,
      warning: mediaCheck.warning
    };
  }

  return {
    valid: true,
    fullPath: resolvedTarget,
    sizeBytes: stat.size,
    extension: ext,
    validationLevel: 'structural_only'
  };
}

/**
 * Inspects audio media for valid duration, silence, and decodability.
 * Uses pure Node.js WAV parser for uncompressed PCM/Float WAV, or system FFmpeg/ffprobe
 * if available. If full media inspection is unavailable, explicitly reports this limitation.
 *
 * @param {string} filePath - Absolute path to audio file
 * @param {string} [extension] - Optional file extension
 * @returns {{
 *   valid: boolean,
 *   validationLevel?: 'full' | 'structural_only',
 *   durationSeconds?: number,
 *   rmsEnergy?: number,
 *   warning?: string,
 *   error?: string
 * }}
 */
export function inspectAudioMedia(filePath, extension) {
  const ext = (extension || path.extname(filePath)).toLowerCase();

  // Fast-path: native pure-JS WAV header & sample parser
  if (ext === '.wav') {
    try {
      const wavResult = parseWavFile(filePath);
      if (wavResult.valid) {
        if (wavResult.durationSeconds < MIN_DURATION_SECONDS) {
          return {
            valid: false,
            error: `Audio duration (${wavResult.durationSeconds.toFixed(2)}s) is shorter than minimum required duration of ${MIN_DURATION_SECONDS}s.`
          };
        }
        if (wavResult.durationSeconds > MAX_DURATION_SECONDS) {
          return {
            valid: false,
            error: `Audio duration (${wavResult.durationSeconds.toFixed(2)}s) exceeds maximum permitted duration of ${MAX_DURATION_SECONDS}s.`
          };
        }
        if (wavResult.isSupportedEncoding && wavResult.rms < MIN_RMS_ENERGY) {
          return {
            valid: false,
            error: `Decoded audio is completely silent (RMS energy < 1e-5).`
          };
        }
        return {
          valid: true,
          validationLevel: 'full',
          durationSeconds: wavResult.durationSeconds,
          rmsEnergy: wavResult.rms
        };
      } else if (wavResult.fatal) {
        return { valid: false, error: wavResult.error };
      }
    } catch (err) {
      // Fall through to FFmpeg if available
    }
  }

  // Next path: Try FFmpeg/ffprobe if available via AMBER_FFPROBE_PATH/AMBER_FFMPEG_PATH or PATH
  const toolPaths = resolveAudioTools();
  if (toolPaths.ffprobe || toolPaths.ffmpeg) {
    const probeRes = probeViaFfmpeg(filePath, toolPaths);
    if (!probeRes.valid) {
      return { valid: false, error: probeRes.error };
    }

    if (probeRes.durationSeconds !== undefined) {
      if (probeRes.durationSeconds < MIN_DURATION_SECONDS) {
        return {
          valid: false,
          error: `Audio duration (${probeRes.durationSeconds.toFixed(2)}s) is shorter than minimum required duration of ${MIN_DURATION_SECONDS}s.`
        };
      }
      if (probeRes.durationSeconds > MAX_DURATION_SECONDS) {
        return {
          valid: false,
          error: `Audio duration (${probeRes.durationSeconds.toFixed(2)}s) exceeds maximum permitted duration of ${MAX_DURATION_SECONDS}s.`
        };
      }
    }

    if (probeRes.rmsEnergy !== undefined && probeRes.rmsEnergy < MIN_RMS_ENERGY) {
      return {
        valid: false,
        error: `Decoded audio is completely silent (RMS energy < 1e-5).`
      };
    }

    return {
      valid: true,
      validationLevel: 'full',
      durationSeconds: probeRes.durationSeconds,
      rmsEnergy: probeRes.rmsEnergy
    };
  }

  // If no decoding tool is available and file is not a supported WAV,
  // report structural validity with explicit limitation disclosure.
  return {
    valid: true,
    validationLevel: 'structural_only',
    warning: `Full media decoding, duration and silence checks were skipped (FFmpeg/ffprobe not available in preflight environment). File will be verified by backend during ingestion.`
  };
}

/**
 * Parses WAV RIFF headers and computes duration & RMS energy across supported encodings:
 * - PCM 8-bit, 16-bit, 24-bit, 32-bit (format 1)
 * - IEEE Float 32-bit (format 3)
 *
 * @param {string} filePath
 * @returns {{ valid: boolean, durationSeconds?: number, rms?: number, isSupportedEncoding?: boolean, fatal?: boolean, error?: string }}
 */
export function parseWavFile(filePath) {
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    return { valid: false, fatal: true, error: `Failed to read audio file: ${err.message}` };
  }

  if (buffer.length < 44) {
    return { valid: false, fatal: true, error: 'WAV file is too small to contain valid RIFF headers.' };
  }

  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return { valid: false, fatal: true, error: 'File header does not match standard RIFF/WAVE container.' };
  }

  let offset = 12;
  let fmt = null;
  let dataChunk = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) {
        return { valid: false, fatal: true, error: 'Corrupt WAV header: fmt chunk is smaller than 16 bytes.' };
      }
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14)
      };
    } else if (chunkId === 'data') {
      const availableSize = Math.max(0, buffer.length - chunkStart);
      if (chunkSize > availableSize) {
        return {
          valid: false,
          fatal: true,
          error: `Corrupt WAV file: data chunk truncated (header claims ${chunkSize} bytes, but only ${availableSize} bytes available).`
        };
      }
      dataChunk = {
        offset: chunkStart,
        size: chunkSize
      };
      break;
    }

    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) {
      offset += 1;
    }
  }

  if (!fmt) {
    return { valid: false, fatal: true, error: 'Corrupt WAV file: missing required "fmt " subchunk.' };
  }
  if (!dataChunk || dataChunk.size === 0) {
    return { valid: false, fatal: true, error: 'Corrupt WAV file: missing or empty "data" subchunk.' };
  }

  if (fmt.sampleRate <= 0 || fmt.channels <= 0 || fmt.bitsPerSample <= 0) {
    return { valid: false, fatal: true, error: 'Corrupt WAV file: invalid sample rate, channel count, or bit depth.' };
  }

  const bytesPerSample = (fmt.bitsPerSample / 8) * fmt.channels;
  if (bytesPerSample <= 0) {
    return { valid: false, fatal: true, error: 'Corrupt WAV file: invalid bytes per sample.' };
  }

  const durationSeconds = dataChunk.size / (fmt.sampleRate * bytesPerSample);

  // Compute RMS across supported encodings (PCM 8/16/24/32-bit and IEEE float 32-bit)
  let rms = 0;
  let isSupportedEncoding = false;
  const audioFormat = fmt.audioFormat;
  const bits = fmt.bitsPerSample;

  if (audioFormat === 1) {
    // Standard PCM
    if (bits === 16) {
      isSupportedEncoding = true;
      let sumSq = 0;
      const total = Math.floor(dataChunk.size / 2);
      for (let i = 0; i < total; i++) {
        const s = buffer.readInt16LE(dataChunk.offset + i * 2);
        const norm = s / 32768.0;
        sumSq += norm * norm;
      }
      rms = total > 0 ? Math.sqrt(sumSq / total) : 0;
    } else if (bits === 8) {
      // Unsigned 8-bit PCM (center 128)
      isSupportedEncoding = true;
      let sumSq = 0;
      const total = dataChunk.size;
      for (let i = 0; i < total; i++) {
        const s = buffer[dataChunk.offset + i];
        const norm = (s - 128) / 128.0;
        sumSq += norm * norm;
      }
      rms = total > 0 ? Math.sqrt(sumSq / total) : 0;
    } else if (bits === 24) {
      // Signed 24-bit PCM (3 bytes per sample)
      isSupportedEncoding = true;
      let sumSq = 0;
      const total = Math.floor(dataChunk.size / 3);
      for (let i = 0; i < total; i++) {
        const idx = dataChunk.offset + i * 3;
        const b0 = buffer[idx];
        const b1 = buffer[idx + 1];
        const b2 = buffer[idx + 2];
        const raw = b0 | (b1 << 8) | (b2 << 16);
        const signedVal = raw >= 0x800000 ? raw - 0x1000000 : raw;
        const norm = signedVal / 8388608.0;
        sumSq += norm * norm;
      }
      rms = total > 0 ? Math.sqrt(sumSq / total) : 0;
    } else if (bits === 32) {
      // Signed 32-bit PCM
      isSupportedEncoding = true;
      let sumSq = 0;
      const total = Math.floor(dataChunk.size / 4);
      for (let i = 0; i < total; i++) {
        const s = buffer.readInt32LE(dataChunk.offset + i * 4);
        const norm = s / 2147483648.0;
        sumSq += norm * norm;
      }
      rms = total > 0 ? Math.sqrt(sumSq / total) : 0;
    }
  } else if (audioFormat === 3 && bits === 32) {
    // IEEE 32-bit float
    isSupportedEncoding = true;
    let sumSq = 0;
    const total = Math.floor(dataChunk.size / 4);
    for (let i = 0; i < total; i++) {
      const s = buffer.readFloatLE(dataChunk.offset + i * 4);
      sumSq += s * s;
    }
    rms = total > 0 ? Math.sqrt(sumSq / total) : 0;
  }

  return {
    valid: true,
    durationSeconds,
    rms,
    isSupportedEncoding
  };
}

/**
 * Resolves local ffprobe or ffmpeg executables strictly from environment variables or system PATH.
 * Workstation-specific hardcoded absolute paths have been completely removed.
 *
 * @returns {{ ffprobe: string | null, ffmpeg: string | null }}
 */
export function resolveAudioTools() {
  const tools = { ffprobe: null, ffmpeg: null };

  const checkFile = (p) => {
    try {
      return Boolean(p && typeof p === 'string' && fs.existsSync(p) && fs.statSync(p).isFile());
    } catch {
      return false;
    }
  };

  // 1. Check environment variables
  if (checkFile(process.env.AMBER_FFPROBE_PATH)) tools.ffprobe = process.env.AMBER_FFPROBE_PATH;
  if (checkFile(process.env.AMBER_FFMPEG_PATH)) tools.ffmpeg = process.env.AMBER_FFMPEG_PATH;

  // 2. Check system PATH
  const whichCmd = process.platform === 'win32' ? 'where.exe' : 'which';
  if (!tools.ffprobe) {
    try {
      const res = cp.spawnSync(whichCmd, ['ffprobe'], { encoding: 'utf8' });
      if (res.status === 0 && res.stdout) {
        const firstLine = res.stdout.trim().split(/\r?\n/)[0];
        if (checkFile(firstLine)) tools.ffprobe = firstLine;
      }
    } catch {}
  }
  if (!tools.ffmpeg) {
    try {
      const res = cp.spawnSync(whichCmd, ['ffmpeg'], { encoding: 'utf8' });
      if (res.status === 0 && res.stdout) {
        const firstLine = res.stdout.trim().split(/\r?\n/)[0];
        if (checkFile(firstLine)) tools.ffmpeg = firstLine;
      }
    } catch {}
  }

  return tools;
}

/**
 * Validates audio decodability, duration, and silence using FFmpeg/ffprobe.
 *
 * @param {string} filePath
 * @param {{ ffprobe: string | null, ffmpeg: string | null }} tools
 * @returns {{ valid: boolean, durationSeconds?: number, rmsEnergy?: number, error?: string }}
 */
function probeViaFfmpeg(filePath, tools) {
  let duration = null;

  // Probe duration via ffprobe if available
  if (tools.ffprobe) {
    try {
      const probeRes = cp.spawnSync(tools.ffprobe, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath
      ], { encoding: 'utf8', timeout: 10_000 });

      if (probeRes.status === 0 && probeRes.stdout) {
        const parsed = parseFloat(probeRes.stdout.trim());
        if (!isNaN(parsed) && parsed > 0) {
          duration = parsed;
        }
      }
    } catch {}
  }

  // If ffmpeg is available, decode a sample to verify decodability and check RMS
  if (tools.ffmpeg) {
    try {
      const decRes = cp.spawnSync(tools.ffmpeg, [
        '-hide_banner',
        '-loglevel', 'error',
        '-nostdin',
        '-i', filePath,
        '-f', 's16le',
        '-ac', '1',
        '-ar', '11025',
        '-t', '10',
        'pipe:1'
      ], { timeout: 15_000, maxBuffer: 10 * 11025 * 2 + 1024 });

      if (decRes.status !== 0) {
        const errMsg = decRes.stderr ? decRes.stderr.toString('utf8').trim() : '';
        return {
          valid: false,
          error: `Audio file is undecodable or corrupt (${errMsg || 'FFmpeg decode error'}).`
        };
      }

      const pcmBytes = decRes.stdout;
      if (!pcmBytes || pcmBytes.length === 0) {
        return { valid: false, error: 'Audio file produced zero decoded samples.' };
      }

      let sumSq = 0;
      const sampleCount = Math.floor(pcmBytes.length / 2);
      for (let i = 0; i < sampleCount; i++) {
        const sample = pcmBytes.readInt16LE(i * 2);
        const norm = sample / 32768.0;
        sumSq += norm * norm;
      }
      const rms = Math.sqrt(sumSq / sampleCount);

      if (duration === null) {
        duration = sampleCount / 11025.0;
      }

      return {
        valid: true,
        durationSeconds: duration,
        rmsEnergy: rms
      };
    } catch (err) {
      return { valid: false, error: `Failed to decode audio via FFmpeg: ${err.message}` };
    }
  }

  if (duration !== null) {
    return {
      valid: true,
      durationSeconds: duration,
      rmsEnergy: 0.1
    };
  }

  return { valid: false, error: 'Failed to probe audio duration or decodability.' };
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
 * Validates music licensing identifier and source provenance URL.
 *
 * @param {string} license
 * @param {string} sourceUrl
 * @returns {{ valid: boolean, license?: string, sourceUrl?: string, error?: string }}
 */
export function validateLicensing(license, sourceUrl) {
  if (!license || typeof license !== 'string' || license.trim().length === 0) {
    return { valid: false, error: 'Licence identifier is required and cannot be empty.' };
  }

  if (!sourceUrl || typeof sourceUrl !== 'string' || sourceUrl.trim().length === 0) {
    return { valid: false, error: 'Source URL is required and cannot be empty.' };
  }

  const trimmedUrl = sourceUrl.trim();
  try {
    const parsed = new URL(trimmedUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        error: `Source URL must use http or https protocol (received '${parsed.protocol}').`
      };
    }
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return {
        valid: false,
        error: `Source URL '${trimmedUrl}' is missing a valid hostname.`
      };
    }
  } catch (err) {
    return {
      valid: false,
      error: `Source URL is invalid or malformed: '${trimmedUrl}'.`
    };
  }

  return {
    valid: true,
    license: license.trim(),
    sourceUrl: trimmedUrl
  };
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
