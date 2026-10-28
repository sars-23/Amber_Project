import fs from 'node:fs';
import path from 'node:path';

/**
 * Custom error class for ambiguous upload failures.
 * Thrown when an upload request fails after bytes were sent and the server's outcome is uncertain.
 */
export class AmbiguousUploadError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'AmbiguousUploadError';
    this.isAmbiguous = true;
    this.cause = cause;
  }
}

/**
 * Client for interacting with the Amber REST API.
 * Encapsulates authentication, secret redaction, pagination, and retry logic.
 */
export class AmberClient {
  /**
   * @param {Object} options
   * @param {string} [options.apiUrl] - Base API URL (e.g. http://localhost:8080/api/v1)
   * @param {string} [options.adminApiKey] - Administrative secret token
   * @param {number} [options.timeoutMs=30000] - Request timeout in milliseconds
   * @param {number} [options.maxRetries=3] - Maximum retry attempts for safe transient read errors
   * @param {typeof fetch} [options.customFetch] - Optional fetch implementation for testing
   */
  constructor(options = {}) {
    let url = options.apiUrl || 'http://localhost:8080/api/v1';
    // Strip trailing slash
    this.apiUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    this.adminApiKey = options.adminApiKey ? String(options.adminApiKey).trim() : '';
    this.timeoutMs = options.timeoutMs || 30_000;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : 3;
    this.fetch = options.customFetch || globalThis.fetch;
  }

  /**
   * Redacts the administrative secret key from any string or error message.
   *
   * @param {string} text
   * @returns {string}
   */
  redact(text) {
    if (!text || typeof text !== 'string') return text;
    if (!this.adminApiKey || this.adminApiKey.length < 3) return text;
    return text.replaceAll(this.adminApiKey, '[REDACTED]');
  }

  /**
   * Checks backend health status. Safe read with bounded retries.
   *
   * @returns {Promise<{ status: string, database?: string, version?: string }>}
   */
  async getHealth() {
    const res = await this._fetchWithRetry(`${this.apiUrl}/health`, {
      method: 'GET'
    }, { allowRetryOnTransient: true });
    if (!res.ok) {
      throw new Error(`Health check failed with HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  }

  /**
   * Fetches the entire existing catalogue using pagination. Safe read with bounded retries.
   *
   * @returns {Promise<Array<{ id: number, title: string, artist: string, durationMs: number, fingerprintCount: number }>>}
   */
  async fetchCatalogue() {
    const allSongs = [];
    let page = 0;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      const url = `${this.apiUrl}/songs?page=${page}&size=${pageSize}`;
      const res = await this._fetchWithRetry(url, { method: 'GET' }, { allowRetryOnTransient: true });

      if (!res.ok) {
        const bodyText = await res.text();
        throw new Error(this.redact(`Failed to list catalogue songs (page ${page}) - HTTP ${res.status}: ${bodyText}`));
      }

      const items = await res.json();
      if (!Array.isArray(items) || items.length === 0) {
        hasMore = false;
        break;
      }

      allSongs.push(...items);
      if (items.length < pageSize) {
        hasMore = false;
      } else {
        page++;
      }
    }

    return allSongs;
  }

  /**
   * Uploads and indexes a single audio track.
   *
   * IMPORTANT: Catalogue writes are NOT idempotent and DO NOT support server idempotency keys.
   * Automatic retries for transient errors or network timeouts are strictly disabled.
   * If a timeout, network failure, or 5xx occurs, an AmbiguousUploadError is thrown.
   *
   * @param {string} filePath - Absolute or resolved path to local audio file
   * @param {string} title - Song title
   * @param {string} artist - Song artist
   * @returns {Promise<{ id: number, title: string, artist: string, durationMs: number, fingerprintCount: number }>}
   */
  async uploadSong(filePath, title, artist) {
    if (!this.adminApiKey) {
      throw new Error('Administrative API key required for upload. Configure AMBER_ADMIN_API_KEY.');
    }

    const fileBuffer = await fs.promises.readFile(filePath);
    const fileName = path.basename(filePath);

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });
    formData.append('file', blob, fileName);
    formData.append('title', title);
    formData.append('artist', artist);

    const headers = {
      'X-Amber-Admin-Key': this.adminApiKey,
      'Authorization': `Bearer ${this.adminApiKey}`
    };

    // Catalogue write: transient retry disabled to prevent duplicate uploads
    const res = await this._fetchWithRetry(`${this.apiUrl}/songs`, {
      method: 'POST',
      headers,
      body: formData
    }, { allowRetryOnTransient: false });

    if (res.status === 201) {
      return res.json();
    }

    const bodyText = await res.text();
    const cleanError = this.redact(bodyText);

    if (res.status === 401) {
      throw new Error(`Authentication failed (HTTP 401 Unauthorized): ${cleanError || 'Invalid or missing admin credentials'}`);
    }
    if (res.status === 403) {
      throw new Error(`Authentication forbidden (HTTP 403 Forbidden): ${cleanError || 'Admin key rejected or server unconfigured'}`);
    }
    if (res.status === 400) {
      throw new Error(`Upload rejected (HTTP 400 Bad Request): ${cleanError}`);
    }
    if (res.status === 413) {
      throw new Error(`File too large (HTTP 413 Payload Too Large): ${cleanError}`);
    }

    throw new Error(`Upload failed with HTTP ${res.status}: ${cleanError}`);
  }

  /**
   * Submits an audio query to POST /api/v1/search and records latency. Safe recognition read with bounded retries.
   *
   * @param {string} filePath - Path to audio query excerpt
   * @returns {Promise<{ result: Object, latencyMs: number }>}
   */
  async searchAudio(filePath) {
    const fileBuffer = await fs.promises.readFile(filePath);
    const fileName = path.basename(filePath);

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });
    formData.append('file', blob, fileName);

    const startTime = performance.now();
    const res = await this._fetchWithRetry(`${this.apiUrl}/search`, {
      method: 'POST',
      body: formData
    }, { allowRetryOnTransient: true });
    const latencyMs = Math.round(performance.now() - startTime);

    if (!res.ok) {
      const bodyText = await res.text();
      throw new Error(this.redact(`Search request failed with HTTP ${res.status}: ${bodyText}`));
    }

    const result = await res.json();
    return { result, latencyMs };
  }

  /**
   * Internal fetch wrapper supporting bounded backoff, rate limits (429), and timeout handling.
   *
   * @private
   * @param {string} url
   * @param {RequestInit} options
   * @param {Object} [retryConfig]
   * @param {boolean} [retryConfig.allowRetryOnTransient=true] - If false, halts on first 5xx or network timeout
   */
  async _fetchWithRetry(url, options, retryConfig = {}) {
    const allowRetryOnTransient = retryConfig.allowRetryOnTransient !== false;
    let attempt = 0;
    const maxRetries = allowRetryOnTransient ? this.maxRetries : 0;

    while (true) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetch(url, {
          ...options,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        // Handle rate limiting (429) - respects Retry-After
        if (response.status === 429 && attempt <= this.maxRetries) {
          const retryAfterHeader = response.headers?.get ? response.headers.get('Retry-After') : null;
          let delayMs = 2000;
          if (retryAfterHeader) {
            const parsed = parseInt(retryAfterHeader, 10);
            if (!isNaN(parsed) && parsed > 0) {
              delayMs = parsed * 1000;
            }
          }
          await sleep(delayMs);
          continue;
        }

        // Retry transient server errors (500, 502, 503, 504) ONLY when explicitly safe
        if ([500, 502, 503, 504].includes(response.status)) {
          if (allowRetryOnTransient && attempt <= maxRetries) {
            const backoff = calculateBackoff(attempt);
            await sleep(backoff);
            continue;
          }
          if (!allowRetryOnTransient) {
            const bodyText = await response.text().catch(() => '');
            const cleanErr = this.redact(bodyText);
            throw new AmbiguousUploadError(
              this.redact(`Upload failed with server error HTTP ${response.status}: ${cleanErr || 'Internal Server Error'}. Request was sent but outcome is ambiguous without an idempotency key.`),
              response
            );
          }
        }

        return response;
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof AmbiguousUploadError) {
          throw err;
        }

        const isAbort = err.name === 'AbortError';
        const isNetwork = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed');

        if (allowRetryOnTransient && (isAbort || isNetwork) && attempt <= maxRetries) {
          const backoff = calculateBackoff(attempt);
          await sleep(backoff);
          continue;
        }

        if (!allowRetryOnTransient && (isAbort || isNetwork)) {
          const msg = isAbort
            ? `Upload timed out after ${this.timeoutMs}ms while waiting for server response.`
            : `Upload connection failed (${err.message}).`;
          throw new AmbiguousUploadError(
            this.redact(`${msg} Because Amber does not provide an idempotency key, server processing outcome is uncertain.`),
            err
          );
        }

        const msg = isAbort ? `Request timed out after ${this.timeoutMs}ms` : err.message;
        throw new Error(this.redact(msg));
      }
    }
  }
}

function calculateBackoff(attempt) {
  // Exponential backoff: 500ms, 1000ms, 2000ms + random jitter up to 250ms
  const base = Math.min(5000, 500 * Math.pow(2, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
