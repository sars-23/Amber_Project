# Amber Build Progress

## Project Metadata
- **Project**: Amber (Acoustic Fingerprinting & Real-Time Audio Search Engine)
- **Target Branch**: `main`
- **Backend**: Java 21, Spring Boot 3.3.x, Spring JDBC, Flyway, Testcontainers
- **Frontend**: React 19 / Vite 5, TypeScript 6, Tailwind CSS, Web Audio API, WebSocket
- **Database**: PostgreSQL 16
- **DSP Engine**: Custom Radix-2 Cooley–Tukey FFT, Hann Windowing, Constellation Hashing, Offset Histogram Matching

---

## Phase Milestones Checklist

- [x] **Phase 0 — Workspace, Architecture, and Repository Setup**
  - Git initialized, `.gitignore`, `.env.example`, `compose.yaml`, architecture docs established.
  - Toolchain verified: Java 21, Maven 3.9.9, Node v24, npm 11, FFmpeg verified.
  - Remote status: Verified & synchronized with GitHub repository `sars-23/Amber_Project` on branch `main`.
- [x] **Phase 1 — Audio Ingestion and Normalization**
  - PCM representation (16-bit mono @ 11,025 Hz).
  - FFmpeg integration and validation tests (10 tests passing).
- [x] **Phase 2 — FFT and Spectral Analysis**
  - Custom Radix-2 Cooley-Tukey FFT in pure Java.
  - Hann windowing, STFT framing, 440 Hz peak validation tests (23 tests passing).
- [x] **Phase 3 — Constellation Fingerprints**
  - Spectral peak extraction across logarithmic frequency bands.
  - Peak pairing and 32-bit integer hash encoding/decoding (36 tests passing).
- [x] **Phase 4 — PostgreSQL and Indexing**
  - Flyway migrations, database schema (`songs`, `fingerprints`).
  - Spring JDBC batched inserts, index query plans, integration tests (41 tests passing).
- [x] **Phase 5 — Matching Engine and REST API**
  - Time-coherent offset histogram candidate ranking.
  - REST endpoints for upload, indexing, search, stats, health (50 tests passing).
- [x] **Phase 6 — React Dashboard and Library**
  - Technical dark-mode UI, music library management, waveform visualization.
  - Interactive file search with match diagnostics and offset histograms.
- [x] **Phase 7 — Live Microphone and WebSocket Streaming**
  - AudioWorklet PCM capture, WebSocket binary streaming, rolling query window (52 tests passing).
- [x] **Phase 8 — Noise Lab and Measured Robustness**
  - Controlled noise mixing, synthetic/licensed fixtures, repeatable benchmarks (53 tests passing).
- [x] **Phase 9 — Deployment, CI, and Final Quality Gate**
  - Multi-stage Docker builds, GitHub Actions CI workflow, complete documentation.
- [x] **Post-Build Audit & Robustness Enhancement**
  - Adaptive energy thresholding, 10 logarithmic frequency bands, temporal crest thinning.
  - Empirical noise matching verified down to +6 dB SNR with >88% confidence and <=100ms offset error (55 tests passing).

---

## Commit Log
| Phase | Commit | Message | Status |
|---|---|---|---|
| Phase 0 | `d64b5ce` | `chore: initialize Amber project` | Pushed |
| Phase 1 | `0e6f7b5` | `feat(audio): implement PCM normalization` | Pushed |
| Phase 2 | `8d20a72` | `feat(dsp): implement FFT and spectral analysis` | Pushed |
| Phase 3 | `3a9abed` | `feat(fingerprint): generate constellation hashes` | Pushed |
| Phase 4 | `bd189fd` | `feat(index): persist fingerprints in PostgreSQL` | Pushed |
| Phase 5 | `e450aa4` | `feat(matching): implement offset histogram search` | Pushed |
| Phase 6 | `9f683df` | `feat(ui): add audio search dashboard` | Pushed |
| Phase 7 | `64a8f90` | `feat(audio): support live microphone recognition` | Pushed |
| Phase 8 | `4699ea8` | `feat(demo): build interactive Noise Lab` | Pushed |
| Phase 9 | `44e1556` | `ci: add GitHub Actions and deployment configuration` | Pushed |
| Audit | `c87bf41` | `fix(matching): improve fingerprint robustness` | Pushed |
