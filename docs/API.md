# Amber: REST & WebSocket API Specification

This document details the complete HTTP and WebSocket API contracts for Amber.

---

## 1. Authentication & Authorization Model

Amber separates public query operations from administrative write operations:

- **Public Endpoints**: Health checks, statistics, catalogue exploration, audio search queries, Noise Lab in-memory benchmarks, and live microphone recognition. No credentials required.
- **Administrative Endpoints**: Song upload/indexing (`POST /api/v1/songs`) and track deletion (`DELETE /api/v1/songs/{id}`).
  - **Required Header**: `X-Amber-Admin-Key: <key>` OR `Authorization: Bearer <key>`
  - **Fail-Closed Behavior**: If the backend environment variable `AMBER_ADMIN_API_KEY` is unset or blank, all administrative write operations return `HTTP 403 Forbidden`.
  - **Error Codes**:
    - `401 Unauthorized`: No administrative credentials provided.
    - `403 Forbidden`: Credentials provided but invalid, or server key unconfigured.

---

## 2. REST Endpoints

### 2.1 Health & Statistics

#### `GET /api/v1/health`
Lightweight health and engine diagnostic probe.
- **Auth**: Public
- **Response 200 OK**:
  ```json
  {
    "status": "UP",
    "version": "1.0.0",
    "database": "CONNECTED",
    "sampleRate": 11025,
    "fftSize": 1024,
    "hopSize": 512
  }
  ```

#### `GET /api/v1/stats`
Returns system aggregate totals and query counters.
- **Auth**: Public
- **Response 200 OK**:
  ```json
  {
    "totalSongs": 2,
    "totalFingerprints": 281949,
    "totalDurationMs": 548801,
    "totalSearches": 14,
    "averageSearchLatencyMs": 28.5
  }
  ```

---

### 2.2 Music Library & Catalogue

#### `GET /api/v1/songs`
Retrieves a paginated list of indexed reference songs.
- **Auth**: Public
- **Query Parameters**:
  - `page`: Page index (0-based, default: `0`).
  - `size`: Page size (default: `20`, max: `100`).
  - `limit` / `offset`: Legacy pagination parameters supported for backwards compatibility.
- **Response 200 OK**:
  ```json
  [
    {
      "id": 4,
      "title": "saudebaazi",
      "artist": "Ludwig",
      "durationMs": 356566,
      "fingerprintCount": 180985,
      "createdAt": "2026-10-26T22:33:18.008622Z"
    }
  ]
  ```

#### `GET /api/v1/songs/{id}`
Retrieves metadata for a specific song by ID.
- **Auth**: Public
- **Response 200 OK**: Song object.
- **Response 404 Not Found**: Track does not exist.

#### `POST /api/v1/songs`
Uploads and indexes a reference audio file into PostgreSQL.
- **Auth**: **Admin Only** (`X-Amber-Admin-Key` or `Authorization: Bearer <key>`)
- **Content-Type**: `multipart/form-data`
- **Parameters**:
  - `file`: Audio file (`.wav`, `.mp3`, `.flac`, `.ogg`, `.m4a`; max 25 MB).
  - `title`: String (1..255 characters).
  - `artist`: String (1..255 characters).
- **Response 201 Created**:
  ```json
  {
    "id": 5,
    "title": "Moonlight Sonata",
    "artist": "Ludwig van Beethoven",
    "durationMs": 320000,
    "fingerprintCount": 24500,
    "createdAt": "2026-10-27T06:00:00Z"
  }
  ```
- **Response 401 Unauthorized**: Missing administrative credentials.
- **Response 403 Forbidden**: Invalid administrative credentials or server key unconfigured.
- **Response 400 Bad Request**: Missing file or invalid metadata.

#### `DELETE /api/v1/songs/{id}`
Deletes a song and cascades the removal of all its constellation fingerprints from the database.
- **Auth**: **Admin Only** (`X-Amber-Admin-Key` or `Authorization: Bearer <key>`)
- **Response 204 No Content**: Song deleted successfully.
- **Response 401 Unauthorized**: Missing administrative credentials.
- **Response 403 Forbidden**: Invalid administrative credentials.
- **Response 404 Not Found**: Track ID not found.

---

### 2.3 Audio Search & Matching

#### `POST /api/v1/search`
Identifies an unknown audio file or recording excerpt against the indexed database.
- **Auth**: Public
- **Content-Type**: `multipart/form-data`
- **Parameters**:
  - `file`: Audio excerpt (`.wav`, `.mp3`, etc.; max 25 MB, duration 1s to 600s).
- **Response 200 OK**:
  ```json
  {
    "matched": true,
    "song": {
      "id": 4,
      "title": "saudebaazi",
      "artist": "Ludwig",
      "durationMs": 356566,
      "fingerprintCount": 180985
    },
    "confidence": 0.95,
    "estimatedOffsetMs": 14200,
    "matchedFingerprints": 340,
    "matchingHashes": 340,
    "totalQueryFingerprints": 480,
    "processingTimeMs": 28.5,
    "searchDurationMs": 28.5
  }
  ```

---

### 2.4 Noise Lab In-Memory Benchmark

#### `POST /api/v1/benchmark/robustness`
Executes an isolated, in-memory acoustic degradation benchmark. Does not read from or mutate the PostgreSQL database.
- **Auth**: Public (enforces per-client rate limit)
- **Rate Limit**: Max 10 requests per minute per client IP. Returns `HTTP 429 Too Many Requests` with `Retry-After: <seconds>` when exceeded.
- **Concurrency Limit**: Max 2 concurrent executions (governed by semaphore).
- **Content-Type**: `multipart/form-data`
- **Parameters**:
  - `file`: *(Optional)* User-provided reference WAV/MP3 file (max 10 MB, truncated to 30s max). If omitted, uses the built-in 12-second benchmark symphony.
  - `snrDb`: Signal-to-noise ratio in decibels (default: `20.0`, range: `-10.0` to `50.0`).
  - `offsetSecs`: Starting offset within reference audio (default: `2.0`).
  - `durationSecs`: Excerpt duration to evaluate (default: `4.0`).
- **Response 200 OK**:
  ```json
  {
    "matched": true,
    "referenceTitle": "Benchmark Symphony (Built-in 12s Reference)",
    "effectiveSnrDb": 20.0,
    "targetOffsetMs": 2000,
    "estimatedOffsetMs": 1900,
    "offsetErrorMs": 100,
    "score": 170.1,
    "confidence": 1.0,
    "matchedFingerprints": 209,
    "totalQueryFingerprints": 410,
    "totalReferenceFingerprints": 1167,
    "executionTimeMs": 133.8,
    "topOffsetBuckets": [
      {"offsetMs": 1900, "votes": 170},
      {"offsetMs": 1800, "votes": 25}
    ],
    "explanation": "Acoustic constellation survived +20.0 dB SNR with 170 peak votes and 100 ms offset error."
  }
  ```
- **Response 429 Too Many Requests**: Client rate limit or server concurrency capacity exceeded. Header `Retry-After: <seconds>` included.

---

## 3. WebSocket Audio Stream

- **Endpoint**: `wss://amber-backend-ler4.onrender.com/api/v1/ws/audio-stream` (or `ws://localhost:8080/api/v1/ws/audio-stream`)
- **Protocol**: Native WebSocket over TLS (WSS).
- **Connection Cap**: Max 50 concurrent active sessions. Excess connections closed with policy violation.
- **Audio Framing**:
  - Format: Raw signed 16-bit linear PCM, Little-Endian.
  - Sampling Rate: **11,025 Hz**, Mono channel.
  - Chunk Size: Typically 1024 to 4096 bytes per frame streamed from the client's AudioWorklet.
- **Client Control Messages**:
  - Text frame: `"RESET"` — Clears the rolling buffer and responds with `{"type":"RESET_ACK"}`.
- **Server Match Events**:
  - Text frame streamed whenever sufficient rolling audio (min 2 seconds) is received:
    ```json
    {
      "type": "MATCH_UPDATE",
      "matched": true,
      "song": {
        "id": 4,
        "title": "saudebaazi",
        "artist": "Ludwig"
      },
      "confidence": 0.92,
      "estimatedOffsetMs": 14200,
      "matchedFingerprints": 185,
      "matchingHashes": 185,
      "totalQueryFingerprints": 260,
      "processingTimeMs": 14.2,
      "searchDurationMs": 14.2
    }
    ```
