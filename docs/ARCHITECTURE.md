# Amber: Architecture & System Design Document

## 1. System Overview

Amber is an acoustic music recognition engine designed from first principles as a high-performance **modular monolith**. It ingests audio recordings through file uploads or continuous browser microphone streams, decodes and normalizes them into 11,025 Hz PCM audio, extracts spectral constellations using a custom Radix-2 Cooley–Tukey Fast Fourier Transform (FFT), indexes compact 32-bit hashes into PostgreSQL, and performs sub-second identification using time-coherent offset histogram analysis with independent query coordinates.

```mermaid
flowchart TD
    subgraph Frontend["Frontend Client (React 19 / TypeScript 6 / Vite 5)"]
        UI["User Interface Components\n(Search, Live Mic, Library, Noise Lab)"]
        AudioWorkletNode["AudioWorklet Node\n(pcm-worker.js + 128-Phase Polyphase Sinc)"]
        AudioContext["Web Audio Context\n(48 kHz / 44.1 kHz Input)"]
    end

    subgraph Boundaries["Network Boundaries (Render Edge)"]
        HTTPS["HTTPS REST\n(/api/v1/search, /api/v1/songs, /api/v1/health)"]
        WSS["WSS WebSocket\n(/api/v1/ws/audio-stream)"]
    end

    subgraph Backend["Backend Modular Monolith (Java 21 LTS / Spring Boot 3.3)"]
        subgraph WebSecurity["Transport & Security Layer"]
            SecFilter["AdminAuthService\n(Fail-Closed Constant-Time Auth)"]
            RateLimit["ClientRateLimiter\n(10 req/min LRU Sliding Window)"]
            WSHandler["LiveAudioStreamWebSocketHandler\n(Binary PCM Frames & Buffer Management)"]
        end

        subgraph IngestionDSP["Audio Normalization & DSP Core"]
            Decoder["AudioNormalizer / AudioDecoderService\n(FFmpeg -> 11,025 Hz 16-bit Mono PCM)"]
            Validation["AudioValidationService\n(Header Checks, Bounds 1s-600s, Max 25 MB)"]
            DSP["FFT & STFT Processor\n(Periodic Hann Window, Radix-2 DIT FFT)"]
            PeakExtract["SpectralPeakExtractor\n(10 Logarithmic Bands, Local Maxima)"]
        end

        subgraph FingerprintMatching["Fingerprinting & Matching Engine"]
            Constellation["ConstellationBuilder & FingerprintHashCodec\n(Forward Pairing dt in [1, 63] -> 32-bit Hash)"]
            Matcher["AudioMatchingService\n(Independent Query Support & Deduplication)"]
            Histogram["OffsetHistogram\n(Time Delta Clustering delta_t = t_db - t_query)"]
            Gates["Multi-Factor Acceptance Gates\n(Votes>=4, Score>=3.0, CR>=5%, Margin>=15%, Conf>=35%)"]
        end

        subgraph QueueWorkers["Open Music Background Pipeline"]
            QueueWorker["OpenMusicImportWorker\n(Transactional Row Locks & Lease Recovery)"]
            JamendoClient["JamendoClient\n(Search API & Audio Stream Download)"]
        end
    end

    subgraph Database["Persistence Layer (Neon PostgreSQL 16)"]
        SongsTable[("songs Table\n(id, title, artist, duration_ms, count)")]
        FpTable[("fingerprints Table\n(hash INT, song_id BIGINT, anchor_time_ms INT)")]
        Index[("B-Tree Index\n(idx_fingerprints_hash_song)")]
        JobsTable[("open_music_import_jobs / items\n(Transactional Durable Queue)")]
    end

    UI -->|File Upload / REST| HTTPS
    AudioContext --> AudioWorkletNode
    AudioWorkletNode -->|Binary PCM Frames| WSS
    HTTPS --> SecFilter
    SecFilter --> RateLimit
    RateLimit --> Decoder
    WSS --> WSHandler
    WSHandler --> DSP
    Decoder --> Validation
    Validation --> DSP
    DSP --> PeakExtract
    PeakExtract --> Constellation
    Constellation --> Matcher
    Matcher --> Histogram
    Histogram --> Gates
    Gates --> Database
    QueueWorker --> IngestionDSP
    QueueWorker --> Database
```

---

## 2. Ingestion & Recognition Flows

### 2.1 File Upload Recognition Flow

When a user submits an audio excerpt (WAV, MP3, FLAC, OGG, or M4A) via drag-and-drop:

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Browser
    participant Controller as ApiController (/api/v1/search)
    participant Validator as AudioValidationService
    participant Decoder as AudioDecoderService & AudioNormalizer
    participant DSP as StftProcessor & SpectralPeakExtractor
    participant Codec as FingerprintGenerator
    participant Repo as FingerprintRepository
    participant Matcher as AudioMatchingService
    participant DB as Neon PostgreSQL

    User->>Controller: POST /api/v1/search (Multipart File)
    Controller->>Validator: validateAudioFile(file)
    Validator-->>Controller: Validated (12B <= size <= 25MB, supported format)
    Controller->>Decoder: decodeAndNormalize(file)
    Note over Decoder: Invokes FFmpeg subprocess:<br/>Downsamples to 11,025 Hz, mono, signed 16-bit PCM
    Decoder-->>Controller: PcmAudio(samples[], 11025)
    Controller->>Matcher: matchPcm(pcmAudio)
    Matcher->>DSP: stftProcessor.compute(samples)
    DSP->>DSP: Radix-2 FFT + 10 Logarithmic Bands Peak Extraction
    DSP-->>Codec: List<SpectralPeak>
    Codec->>Codec: Form forward pairs [1, 63] frames & pack 32-bit hashes
    Codec-->>Matcher: List<Fingerprint> queryFingerprints
    Matcher->>Repo: findCandidatesByHashes(distinctHashes)
    Repo->>DB: SELECT hash, song_id, anchor_time_ms FROM fingerprints WHERE hash IN (...)
    DB-->>Repo: List<IndexedFingerprint>
    Repo-->>Matcher: Candidate rows
    Matcher->>Matcher: Deduplicate query coordinates (hash, queryTimeMs)<br/>Accumulate offset histograms with independent query support
    Matcher->>Matcher: Evaluate Acceptance Gates 1-5 (Votes, Score, CR, Margin, Conf)
    alt Match Accepted
        Matcher-->>Controller: MatchResult(matched=true, song, offsetMs, score, confidence, diagnostics)
    else Match Rejected
        Matcher-->>Controller: MatchResult(matched=false, diagnostics with leading candidate metadata)
    end
    Controller-->>User: HTTP 200 OK (JSON MatchResponse)
```

---

### 2.2 Live Microphone Continuous Streaming Flow

When the user activates Live Recognition:

```mermaid
sequenceDiagram
    autonumber
    actor User as Microphone Audio
    participant Context as Web AudioContext (48 kHz)
    participant Worklet as AudioWorklet (pcm-worker.js)
    participant Client as WebSocket Client (React)
    participant Handler as LiveAudioStreamWebSocketHandler
    participant Buffer as SessionAudioBuffer (4.0s Circular)
    participant Matcher as AudioMatchingService

    User->>Context: Acoustic Audio Input
    Context->>Worklet: Float32Array frames (48 kHz)
    Note over Worklet: 20 Hz DC Blocker +<br/>128-Phase Blackman Sinc Polyphase Filter (48k -> 11,025 Hz)
    Worklet->>Client: postMessage({ pcm: Int16Array })
    Client->>Handler: WSS Binary Frame (4096 bytes PCM)
    Handler->>Buffer: write(pcmBytes)
    Note over Buffer: Circular buffer accumulates rolling 4.0s (44,100 samples)
    opt Every 500ms and samples >= 22,050 (2.0s)
        Handler->>Matcher: matchPcm(buffer.getAudio())
        Matcher-->>Handler: MatchResult
        Handler->>Client: WSS Text Frame: MATCH_UPDATE JSON
        Client->>Client: Update Waveform UI & Diagnostics Card
    end
```

---

## 3. Component Boundaries & Responsibilities

### 3.1 Digital Signal Processing (`com.amber.dsp`)
- **`Fft`**: Hand-crafted in-place Radix-2 Cooley–Tukey decimation-in-time Fast Fourier Transform. Operates over arrays of length $N = 1024$ with precomputed bit-reversal indices and cosine/sine twiddle factor lookup tables.
- **`HannWindow`**: Precomputed periodic Hann window coefficients minimizing spectral leakage across frame boundaries.
- **`StftProcessor`**: Frames audio with $N = 1024$ and hop size $H = 512$ (50% overlap), yielding a temporal resolution of $\approx 46.44\text{ ms}$ per frame and frequency resolution of $\approx 10.77\text{ Hz/bin}$.
- **`SpectralPeakExtractor`**: Segments the 512 positive frequency bins into 10 logarithmic frequency sub-bands. Detects prominent local maxima that exceed temporal ($\pm 2$ frames) and spectral ($\pm 2$ bins) neighbors and surpass an adaptive floor of $2.0\times$ the frame band mean.

### 3.2 Acoustic Constellation Hashing (`com.amber.fingerprint`)
- **`ConstellationBuilder`**: Iterates through detected spectral peaks in chronological order, forming forward anchor-target pairings within a target window of $[1, 63]$ frames ($\approx 46.4\text{ ms}$ to $2.93\text{ s}$).
- **`FingerprintHashCodec`**: Packs anchor bin $f_1$ (9 bits), target bin $f_2$ (9 bits), and delta frames $\Delta t$ (6 bits) into a compact signed 32-bit Java integer:
  $$\text{Hash} = (f_1 \ll 15) \mid (f_2 \ll 6) \mid (\Delta t \& 0\text{x}3F)$$

### 3.3 Matching Engine (`com.amber.matching`)
- **`OffsetHistogram`**: Accumulator tracking candidate track alignments at offset $\Delta t = t_{db} - t_{query}$.
- **Independent Query Support**: Each query feature coordinate $q = (\text{hash}, t_q)$ contributes at most one vote to any offset bucket, and at most one vote to the candidate's total distinct query support.
- **`AudioMatchingService`**: Evaluates candidate tracks across 5 multi-factor acceptance gates. Produces safe developer diagnostics (including leading rejected candidate metadata and raw pairwise vote counts) when matches are rejected.

### 3.4 Persistent Storage & Indexing (`com.amber.indexing`, `com.amber.song`)
- **PostgreSQL 16 on Neon**: Hosted serverless PostgreSQL with SSL enforced.
- **`songs` table**: Primary metadata store (`id`, `title`, `artist`, `duration_ms`, `fingerprint_count`, `created_at`).
- **`fingerprints` table**: Relational inverted index (`hash INT`, `song_id BIGINT`, `anchor_time_ms INT`).
- **Index**: High-performance composite B-Tree index on `(hash, song_id)` optimizing batch candidate lookups (`SELECT hash, song_id, anchor_time_ms FROM fingerprints WHERE hash IN (...)`).

### 3.5 Security & Operational Controls (`com.amber.security`)
- **`AdminAuthService`**: Verifies `X-Amber-Admin-Key` or `Authorization: Bearer <key>` using constant-time `MessageDigest.isEqual`. Fails closed if `AMBER_ADMIN_API_KEY` is unconfigured.
- **`ClientRateLimiter`**: Sliding-window rate limiting on compute-intensive benchmark routes (10 req/min). Backed by an LRU cache bounded to 10,000 tracked clients with Render reverse-proxy IP resolution.
- **WebSocket Concurrency**: Limits concurrent active connections to 50 sessions with per-session circular buffers.

### 3.6 Frontend Architecture (`frontend/src`)
- **React 19 & TypeScript 6**: Strict type-safe UI built with Vite 5 and Tailwind CSS 3.4.
- **Real-Time Audio Capture**: Web Audio API with native `AudioWorklet` processor executing a 128-phase Blackman-windowed sinc polyphase resampler (4,800 Hz cutoff), supported by an automatic `ScriptProcessor` fallback.
- **HTML5 Canvas Oscilloscope**: Time-domain waveform visualizer and live dBFS level meter.
- **Developer Diagnostics Panel**: Collapsible observability view exposing query fingerprint counts, database candidate rows, winning candidate score, coherence ratio, separation margin, and top 15 histogram buckets.
