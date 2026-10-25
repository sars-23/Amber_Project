# Amber: Architecture Decision Document

## 1. System Overview
Amber is an acoustic fingerprinting and audio search engine built as a modular monolith. It ingests arbitrary audio files (or live microphone streams), decodes and normalizes them into PCM audio, computes spectral constellations using a custom Radix-2 Cooley-Tukey FFT, indexes compact 32-bit hashes into PostgreSQL, and performs sub-second matching using time-coherent offset histogram analysis.

```mermaid
graph TD
    Client["React + TypeScript Frontend\n(Vite + Web Audio API)"]
    WebSocket["WebSocket Audio Stream\n(/api/v1/ws/audio-stream)"]
    RestApi["REST Endpoints\n(/api/v1/songs, /api/v1/search)"]
    AudioDecoder["Audio Ingestion & Normalizer\n(FFmpeg -> 11,025 Hz 16-bit Mono PCM)"]
    DspEngine["DSP Core\n(Hann Window + Radix-2 FFT + STFT)"]
    PeakExtractor["Constellation Extractor\n(Log Frequency Bands & Local Maxima)"]
    FingerprintCodec["32-bit Hash Codec\n(Anchor Freq | Target Freq | Delta Time)"]
    MatchingEngine["Matching Engine\n(Offset Histogram Clustering)"]
    Database[("PostgreSQL 16\n(Indexed songs & fingerprints)")]

    Client -->|HTTP/REST| RestApi
    Client -->|Binary PCM Chunks| WebSocket
    RestApi --> AudioDecoder
    WebSocket --> DspEngine
    AudioDecoder --> DspEngine
    DspEngine --> PeakExtractor
    PeakExtractor --> FingerprintCodec
    FingerprintCodec -->|Batch Insert| Database
    FingerprintCodec -->|Query Hashes| MatchingEngine
    MatchingEngine -->|Batch Hash Lookup| Database
    MatchingEngine -->|Ranked MatchResult| RestApi
    MatchingEngine -->|Stream Recognition| WebSocket
```

## 2. Component Boundaries
1. **Audio Ingestion (`com.Amber.audio`)**:
   - `AudioNormalizer`: Converts multi-format inputs (WAV, MP3, etc.) into mono, signed 16-bit PCM at 11,025 Hz using FFmpeg.
   - `PcmAudio`: Strongly typed value object holding raw byte/sample arrays, sample rate, and duration.
   - `AudioValidationService`: Checks input size, mime types, sample counts, duration bounds.
2. **Digital Signal Processing (`com.Amber.dsp`)**:
   - `Fft`: Pure Java in-place Radix-2 Cooley-Tukey decimation-in-time FFT.
   - `HannWindow`: Precomputed periodic Hann window coefficients.
   - `StftProcessor`: Window framing with 50% overlap (hop size = 512, frame size = 1024).
   - `SpectralPeakExtractor`: Adaptive thresholding across logarithmic frequency bands.
3. **Fingerprinting (`com.Amber.fingerprint`)**:
   - `ConstellationBuilder`: Groups spectral peaks into anchor-target pairings within a forward target zone ($dt \in [1, 63]$).
   - `FingerprintHashCodec`: Bitwise packing into 32-bit signed/unsigned integer representation:
     - Anchor Freq Bin (9 bits: 0..511)
     - Target Freq Bin (9 bits: 0..511)
     - Delta Frames (6 bits: 1..63)
4. **Database & Indexing (`com.Amber.indexing`, `com.Amber.song`)**:
   - PostgreSQL storage with Flyway versioned migrations.
   - `songs` table: id, title, artist, duration_ms, fingerprint_count, created_at.
   - `fingerprints` table: hash (INT), song_id (BIGINT FK), anchor_time_ms (INT).
   - B-tree indexing on `(hash, song_id)` for high-throughput batch lookups.
5. **Matching Engine (`com.Amber.matching`)**:
   - `OffsetHistogram`: Evaluates candidate time delta clustering ($\Delta t = t_{db} - t_{query}$).
   - Peak concentration scoring with background noise discrimination.
6. **Frontend Experience (`frontend/src`)**:
   - Clean technical audio dashboard, Web Audio API spectrogram visualization, interactive search, Noise Lab simulation, and live AudioWorklet microphone streaming.
