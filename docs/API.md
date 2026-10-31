# Amber: REST & WebSocket API Specification

This document details the complete HTTP and WebSocket API contracts for Amber.

---

## 1. Authentication & Authorization Model

Amber separates public query operations from administrative write operations:

- **Public Endpoints**: Health checks, statistics, catalogue exploration, audio search queries, Noise Lab in-memory benchmarks, Open Music public search, and live microphone recognition. No credentials required.
- **Administrative Endpoints**:
  - Song upload & indexing: `POST /api/v1/songs`
  - Track deletion: `DELETE /api/v1/songs/{id}`
  - Open Music import queuing & management: `POST /api/v1/open-music/jobs`, `GET /api/v1/open-music/jobs/{id}`, `GET /api/v1/open-music/jobs/active`, `POST /api/v1/open-music/jobs/{id}/retry-failed`, `POST /api/v1/open-music/jobs/{id}/cancel`
- **Authentication Headers**:
  - `X-Amber-Admin-Key: <ADMIN_API_KEY>` OR `Authorization: Bearer <ADMIN_API_KEY>`
- **Fail-Closed Behavior**: If `AMBER_ADMIN_API_KEY` is unset or blank in the server environment, all administrative write operations return `HTTP 403 Forbidden`.
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
    "totalSongs": 35,
    "totalFingerprints": 3325966,
    "totalDurationMs": 7621063,
    "totalSearches": 150,
    "averageSearchLatencyMs": 731.9
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
  - `limit` / `offset`: Supported for backwards compatibility.
- **Response 200 OK**:
  ```json
  [
    {
      "id": 41,
      "title": "DJ_Snake_-_Let_Me_Love_You_(Official_Music_Video)_ft._Justin_Bieber",
      "artist": "Unknown Artist",
      "durationMs": 205322,
      "fingerprintCount": 91269,
      "createdAt": "2026-10-31T13:28:42.450248Z"
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
- **Auth**: **Admin Only** (`X-Amber-Admin-Key` or `Authorization: Bearer <ADMIN_API_KEY>`)
- **Content-Type**: `multipart/form-data`
- **Parameters**:
  - `file`: Audio file (`.wav`, `.mp3`, `.flac`, `.ogg`, `.m4a`; max 25 MB).
  - `title`: String (1..255 characters).
  - `artist`: String (1..255 characters).
- **Response 201 Created**:
  ```json
  {
    "id": 42,
    "title": "Sample Song",
    "artist": "Sample Artist",
    "durationMs": 180000,
    "fingerprintCount": 42100,
    "createdAt": "2026-10-31T21:00:00Z"
  }
  ```
- **Response 401 Unauthorized**: Missing administrative credentials.
- **Response 403 Forbidden**: Invalid administrative credentials or server key unconfigured.
- **Response 400 Bad Request**: Missing file or invalid metadata.

#### `DELETE /api/v1/songs/{id}`
Deletes a song and cascades the removal of all its constellation fingerprints from the database.
- **Auth**: **Admin Only** (`X-Amber-Admin-Key` or `Authorization: Bearer <ADMIN_API_KEY>`)
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
- **Response 200 OK (Match Confirmed)**:
  ```json
  {
    "matched": true,
    "song": {
      "id": 41,
      "title": "DJ_Snake_-_Let_Me_Love_You_(Official_Music_Video)_ft._Justin_Bieber",
      "artist": "Unknown Artist",
      "durationMs": 205322,
      "fingerprintCount": 91269,
      "createdAt": "2026-10-31T13:28:42.450248Z"
    },
    "estimatedOffsetMs": 29900,
    "score": 140.7,
    "confidence": 0.94,
    "matchingHashes": 775,
    "matchedFingerprints": 775,
    "totalQueryFingerprints": 1352,
    "searchDurationMs": 28.5,
    "processingTimeMs": 28.5,
    "message": "Acoustic match confirmed with high confidence.",
    "offsetHistogram": [
      {"offsetMs": 29900, "votes": 126},
      {"offsetMs": 30000, "votes": 30}
    ],
    "diagnostics": {
      "queryFingerprints": 1352,
      "distinctQueryHashes": 1123,
      "candidateFingerprintRows": 115656,
      "candidateSongs": 35,
      "winningSongId": 41,
      "winningSongTitle": "DJ_Snake_-_Let_Me_Love_You_(Official_Music_Video)_ft._Justin_Bieber",
      "winningSongArtist": "Unknown Artist",
      "winningScore": 140.7,
      "winningPeakVotes": 126,
      "totalWinningVotes": 775,
      "rawPairwiseVotes": 11913,
      "coherenceRatio": 0.1626,
      "runnerUpScore": 17.1,
      "margin": 0.86,
      "estimatedOffsetMs": 29900,
      "rejectionGate": "NONE",
      "rejectionReason": "Acoustic match confirmed with high confidence.",
      "searchDurationMs": 28.5,
      "topBuckets": [
        {"offsetMs": 29900, "votes": 126},
        {"offsetMs": 30000, "votes": 30}
      ]
    }
  }
  ```

> [!NOTE]
> **Production Search Timing Metric**:
> `searchDurationMs` (and backwards-compatible property `processingTimeMs`) measures the duration of `AudioMatchingService.matchFingerprints()` in milliseconds. The timer begins **after** query audio decoding and STFT fingerprint generation have finished. It measures candidate retrieval from PostgreSQL, independent query coordinate accumulation, candidate ranking, and acceptance gate evaluations. It does not measure browser-to-server network transport or container FFmpeg decoding.

- **Response 200 OK (Match Rejected with Safe Diagnostics)**:
  ```json
  {
    "matched": false,
    "song": null,
    "estimatedOffsetMs": 0,
    "score": 2.1,
    "confidence": 0.12,
    "matchingHashes": 14,
    "matchedFingerprints": 14,
    "totalQueryFingerprints": 480,
    "searchDurationMs": 18.2,
    "processingTimeMs": 18.2,
    "message": "Insufficient time-coherent votes in peak offset bucket.",
    "offsetHistogram": [
      {"offsetMs": 14200, "votes": 2}
    ],
    "diagnostics": {
      "queryFingerprints": 480,
      "distinctQueryHashes": 410,
      "candidateFingerprintRows": 320,
      "candidateSongs": 4,
      "winningSongId": 12,
      "winningSongTitle": "Unconfirmed Leading Track",
      "winningSongArtist": "Unknown Artist",
      "winningScore": 2.1,
      "winningPeakVotes": 2,
      "totalWinningVotes": 14,
      "rawPairwiseVotes": 32,
      "coherenceRatio": 0.1429,
      "runnerUpScore": 1.0,
      "margin": 0.52,
      "estimatedOffsetMs": 14200,
      "rejectionGate": "GATE_1_PEAK_VOTES",
      "rejectionReason": "Insufficient time-coherent votes in peak offset bucket.",
      "searchDurationMs": 18.2,
      "topBuckets": [
        {"offsetMs": 14200, "votes": 2}
      ]
    }
  }
  ```

---

### 2.4 Noise Lab In-Memory Benchmark

#### `POST /api/v1/benchmark/robustness`
Executes an isolated, in-memory acoustic degradation benchmark without reading from or mutating PostgreSQL.
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
    "snrDb": 20.0,
    "targetOffsetMs": 2000,
    "estimatedOffsetMs": 1900,
    "offsetErrorMs": 100,
    "score": 155.0,
    "confidence": 1.0,
    "matchingHashes": 155,
    "matchedFingerprints": 155,
    "totalQueryFingerprints": 410,
    "totalReferenceFingerprints": 1167,
    "searchDurationMs": 133.8,
    "processingTimeMs": 133.8,
    "offsetHistogram": [
      {"offsetMs": 1900, "votes": 155},
      {"offsetMs": 1800, "votes": 25}
    ],
    "explanation": "Acoustic constellation survived +20.0 dB SNR with 155 peak votes and 100 ms offset error."
  }
  ```

> [!NOTE]
> **Noise Lab In-Memory Benchmark Timing**:
> `RobustnessBenchmarkService` starts its timer before in-memory processing begins. Its `searchDurationMs` (and `processingTimeMs`) encompasses the entire in-memory test bench execution: reference audio decoding or melody synthesis, clean excerpt slicing, deterministic Gaussian noise generation (`Random(1337)`), query STFT fingerprint generation, and local hash-map pairwise offset matching. It performs zero database operations and zero network calls.

---

### 2.5 Open Music Importer

#### `GET /api/v1/open-music/search`
Queries Jamendo's public API for downloadable Creative Commons tracks.
- **Auth**: Public (rate limited to 30 req/min per IP, with 3-minute LRU caching).
- **Parameters**:
  - `q`: Search query string (title, genre, artist).
  - `limit`: Number of tracks to return (default: `20`, max: `50`).
- **Response 200 OK**:
  ```json
  [
    {
      "id": "123456",
      "name": "Acoustic Horizon",
      "artistName": "Creative Artist",
      "duration": 184,
      "licenseCcUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
      "audioDownloadUrl": null,
      "audioDownloadAllowed": true
    }
  ]
  ```

#### `POST /api/v1/open-music/jobs`
Queues a batch of Jamendo tracks for background fingerprinting and indexing.
- **Auth**: **Admin Only** (`X-Amber-Admin-Key` or `Authorization: Bearer <ADMIN_API_KEY>`)
- **Content-Type**: `application/json`
- **Request Body**:
  ```json
  {
    "trackIds": ["123456", "123457"]
  }
  ```
- **Response 201 Created**: Import job record with initial `QUEUED` item statuses.

---

## 3. WebSocket Real-Time Audio Streaming

- **Endpoint**: `wss://amber-backend-ler4.onrender.com/api/v1/ws/audio-stream` (or `ws://localhost:8080/api/v1/ws/audio-stream`)
- **Protocol**: Binary WebSocket frames over TLS.
- **Connection Cap**: Max 50 concurrent active sessions.
- **Audio Framing**:
  - Sample Rate: **11,025 Hz**, Mono channel.
  - Format: Signed 16-bit linear PCM, Little-Endian.
  - Chunk Size: Typically 1024 to 4096 bytes per frame.

### 3.1 Server Connection Handshake (`STREAM_READY`)
Immediately upon connection establishment, the server emits a session initialization message:
```json
{
  "type": "STREAM_READY",
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef0123456789",
  "targetSampleRate": 11025,
  "minRecognitionSamples": 22050,
  "minRecognitionDurationSec": 2.0,
  "windowCapacitySamples": 44100
}
```

### 3.2 Periodic Evaluation (`MATCH_UPDATE`)
As binary PCM frames are appended to the session's circular buffer, the engine evaluates recognition every 500 ms once $\ge 2.0\text{ s}$ of audio has accumulated:

```json
{
  "type": "MATCH_UPDATE",
  "matched": true,
  "song": {
    "id": 41,
    "title": "DJ_Snake_-_Let_Me_Love_You_(Official_Music_Video)_ft._Justin_Bieber",
    "artist": "Unknown Artist",
    "durationMs": 205322,
    "fingerprintCount": 91269
  },
  "confidence": 0.74,
  "estimatedOffsetMs": 29900,
  "matchedFingerprints": 350,
  "matchingHashes": 350,
  "totalQueryFingerprints": 480,
  "processingTimeMs": 22.4,
  "searchDurationMs": 22.4,
  "receivedSamples": 66150,
  "message": "Acoustic match confirmed with high confidence.",
  "diagnostics": {
    "queryFingerprints": 480,
    "distinctQueryHashes": 420,
    "candidateFingerprintRows": 45000,
    "candidateSongs": 18,
    "winningSongId": 41,
    "winningSongTitle": "DJ_Snake_-_Let_Me_Love_You_(Official_Music_Video)_ft._Justin_Bieber",
    "winningSongArtist": "Unknown Artist",
    "winningScore": 34.2,
    "winningPeakVotes": 28,
    "totalWinningVotes": 350,
    "rawPairwiseVotes": 5232,
    "coherenceRatio": 0.08,
    "runnerUpScore": 8.0,
    "margin": 0.76,
    "estimatedOffsetMs": 29900,
    "rejectionGate": "NONE",
    "rejectionReason": "Acoustic match confirmed with high confidence.",
    "searchDurationMs": 22.4,
    "topBuckets": [
      {"offsetMs": 29900, "votes": 28}
    ]
  }
}
```

### 3.3 Client Control Messages
- **`RESET`**: Sending text frame `"RESET"` clears the session buffer and returns:
  ```json
  {"type": "RESET_ACK", "status": "BUFFER_CLEARED"}
  ```
