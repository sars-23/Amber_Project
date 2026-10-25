# Amber: REST & WebSocket API Specification

## 1. REST Endpoints

### 1.1 Health & Engine Status
- **`GET /api/v1/health`**
  - **Response 200 OK**:
    ```json
    {
      "status": "UP",
      "version": "1.0.0",
      "database": "CONNECTED",
      "sampleRate": 11025,
      "fftSize": 1024
    }
    ```

- **`GET /api/v1/stats`**
  - Returns global statistics (total songs, total fingerprints, indexed duration, average query latency).
  - **Response 200 OK**:
    ```json
    {
      "totalSongs": 12,
      "totalFingerprints": 184520,
      "totalDurationMs": 2450000,
      "averageSearchMs": 32.4
    }
    ```

### 1.2 Songs Management
- **`GET /api/v1/songs`**
  - Query params: `page` (default 0), `size` (default 20), `query` (optional title/artist filter).
  - Returns paginated song list with duration and fingerprint count.

- **`GET /api/v1/songs/{id}`**
  - Returns details of a specific track.

- **`POST /api/v1/songs`**
  - Content-Type: `multipart/form-data`
  - Parameters:
    - `file`: Audio file (WAV, MP3, OGG, FLAC; max 25MB).
    - `title`: String (1..255 chars).
    - `artist`: String (1..255 chars).
  - **Response 201 Created**:
    ```json
    {
      "id": 1,
      "title": "Symphony No. 5",
      "artist": "Ludwig van Beethoven",
      "durationMs": 420000,
      "fingerprintCount": 38400,
      "createdAt": "2026-10-26T01:00:00Z"
    }
    ```

- **`DELETE /api/v1/songs/{id}`**
  - Deletes the song and cascades all associated fingerprints.
  - **Response 204 No Content**.

### 1.3 Audio Search
- **`POST /api/v1/search`**
  - Content-Type: `multipart/form-data`
  - Parameter: `file` (WAV/MP3 audio excerpt, min 1s, max 30s).
  - **Response 200 OK**:
    ```json
    {
      "matched": true,
      "song": {
        "id": 1,
        "title": "Symphony No. 5",
        "artist": "Ludwig van Beethoven",
        "durationMs": 420000
      },
      "estimatedOffsetMs": 14250,
      "score": 94.5,
      "matchingHashes": 342,
      "totalQueryFingerprints": 520,
      "searchDurationMs": 28.1,
      "offsetHistogram": [
        {"offsetMs": 14200, "votes": 42},
        {"offsetMs": 14250, "votes": 185},
        {"offsetMs": 14300, "votes": 65}
      ]
    }
    ```

## 2. WebSocket Audio Streaming

- **Endpoint**: `ws://<host>:8080/api/v1/ws/audio-stream`
- **Protocol**:
  - Client sends raw binary PCM chunks (16-bit signed integer, 11,025 Hz, Little Endian).
  - Client can also send JSON control frames:
    ```json
    {"action": "RESET_BUFFER"}
    ```
  - Server maintains a rolling sliding window (default 4 seconds) and streams real-time match events:
    ```json
    {
      "type": "MATCH_RESULT",
      "matched": true,
      "songId": 1,
      "title": "Symphony No. 5",
      "artist": "Ludwig van Beethoven",
      "estimatedOffsetMs": 14300,
      "confidence": 0.94,
      "score": 88.2
    }
    ```
