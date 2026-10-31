# Amber Build Progress & Milestones

## Project Metadata
- **Project**: Amber (Acoustic Fingerprinting & Real-Time Audio Search Engine)
- **Target Branch**: `main`
- **Backend**: Java 21 LTS, Spring Boot 3.3.4, Spring JDBC, Flyway, HikariCP, Testcontainers
- **Frontend**: React 19.3 / Vite 5.4, TypeScript 6.0, Tailwind CSS 3.4, Web Audio API, WebSocket
- **Database**: PostgreSQL 16 on Neon Serverless
- **DSP Engine**: Custom Radix-2 Cooley–Tukey FFT, Periodic Hann Windowing, 10-Band Logarithmic Peak Extraction, Constellation Hashing, Independent Query-Support Offset Histogram Matching
- **Automated Quality Gates**: 286 Total Tests (212 Backend, 40 Frontend, 34 Tools/Scripts) — 100% Passing in GitHub Actions CI

---

## Phase Milestones Checklist

- [x] **Phase 0 — Workspace, Architecture, and Repository Setup**
  - Git initialized, `.gitignore`, `.env.example`, `compose.yaml`, architecture docs established.
  - Toolchain verified: Java 21, Maven 3.9.9, Node v22, npm 10, FFmpeg verified.
  - Remote status: Synchronized with GitHub repository `sars-23/Amber_Project` on branch `main`.
- [x] **Phase 1 — Audio Ingestion and Normalization**
  - PCM representation (16-bit mono @ 11,025 Hz).
  - FFmpeg integration and validation tests (10 tests passing).
- [x] **Phase 2 — FFT and Spectral Analysis**
  - Custom in-place Radix-2 Cooley-Tukey FFT in pure Java (zero external math packages).
  - Hann windowing, STFT framing, 440 Hz peak validation tests (23 tests passing).
- [x] **Phase 3 — Constellation Fingerprints**
  - Spectral peak extraction across 10 logarithmic frequency sub-bands.
  - Forward anchor-target pairing ($\Delta t \in [1, 63]$ frames) and 32-bit compact hash encoding (36 tests passing).
- [x] **Phase 4 — PostgreSQL and Indexing**
  - Flyway migrations (`V1__init_schema.sql`), database schema (`songs`, `fingerprints`).
  - Spring JDBC batched inserts, composite B-Tree index on `(hash, song_id)` (41 tests passing).
- [x] **Phase 5 — Matching Engine and REST API**
  - Time-coherent offset histogram candidate ranking.
  - REST endpoints for upload, indexing, search, stats, health (50 tests passing).
- [x] **Phase 6 — React Dashboard and Library**
  - Technical UI, music library management, waveform visualization.
  - Interactive file search with match diagnostics and offset histograms.
- [x] **Phase 7 — Live Microphone and WebSocket Streaming**
  - AudioWorklet PCM capture, WebSocket binary streaming, rolling query window (52 tests passing).
- [x] **Phase 8 — Noise Lab and Measured Robustness**
  - Controlled noise mixing, synthetic/licensed fixtures, repeatable benchmarks (53 tests passing).
- [x] **Phase 9 — Deployment, CI, and Final Quality Gate**
  - Multi-stage Docker builds, GitHub Actions CI workflow, complete documentation.
- [x] **Phase 10 — Open Music Importer & Enterprise Queue Hardening**
  - Jamendo API integration with public search rate limiting and 3-minute LRU caching.
  - Flyway migrations `V2__open_music_importer.sql` and `V3__open_music_hardening.sql`.
  - Transactional row locking (`FOR UPDATE`), durable lease management, auto-recovery (170 tests passing).
  - Explicit Jamendo licensing usage notice and operational governance gates.
- [x] **Phase 11 — Polyphase Resampling & Live Streaming Diagnostics**
  - 128-phase Blackman-windowed sinc polyphase resampler (4,800 Hz cutoff) in `AudioWorklet` with `ScriptProcessor` fallback.
  - 20 Hz DC blocker, RMS level monitoring, input device selection.
  - Developer diagnostics panel exposing candidate scores, gates, and top 15 histogram buckets.
- [x] **Phase 12 — Independent Query Support & Vote Multiplication Resolution**
  - Replaced Cartesian product vote accumulation with independent query coordinates `(hash, queryTimeMs)`.
  - Bounded candidate support and offset buckets to distinct query features.
  - Resolved false rejection on dense tracks, verified with physical mic audio playing Song ID 41.
  - Added 11 regression tests in `MatchingDiagnosticsAndAccumulationTest.java` (212 backend tests passing).
- [x] **Phase 13 — Amber v1 Portfolio Release Package**
  - Audited and updated all documentation (`README.md`, `ARCHITECTURE.md`, `ALGORITHM.md`, `API.md`, `DEPLOYMENT.md`, `BENCHMARKS.md`).
  - Created professional demonstration script (`docs/DEMO_SCRIPT.md`).
  - Created portfolio engineering case study with resume bullets and 5 technical interview Q&As (`docs/PORTFOLIO_CASE_STUDY.md`).
  - Added comprehensive Mermaid architecture and sequence diagrams across documentation.
  - Verified 100% pass rate across all 286 tests in CI.
- [x] **Phase 14 — Amber v1 Final Release Freeze (PR #13)**
  - Audited and aligned API contracts across backend DTOs (`MatchResponse`, `BenchmarkResponse`) and documentation.
  - Corrected timing field names (`searchDurationMs`, `processingTimeMs`) and removed invalid references (`executionTimeMs`, `effectiveSnrDb`, `topOffsetBuckets`).
  - Documented exact measurement boundaries between production matching and in-memory Noise Lab benchmarking.
  - Finalized technical portfolio package, confirmed 100% CI pass rate, and declared Amber v1 scope frozen.
