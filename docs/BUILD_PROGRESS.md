# EchoTrace Build Progress

## Project Metadata
- **Project**: EchoTrace (Acoustic Fingerprinting & Real-Time Audio Search Engine)
- **Target Branch**: `main` (or `feat/echotrace-build`)
- **Backend**: Java 21, Spring Boot 3.3.x, Spring JDBC, Flyway, Testcontainers
- **Frontend**: React 18 / Vite, TypeScript, Tailwind CSS, Web Audio API, WebSocket
- **Database**: PostgreSQL 16
- **DSP Engine**: Custom Radix-2 Cooley–Tukey FFT, Hann Windowing, Constellation Hashing, Offset Histogram Matching

---

## Phase Milestones Checklist

- [x] **Phase 0 — Workspace, Architecture, and Repository Setup**
  - Git initialized, `.gitignore`, `.env.example`, `compose.yaml`, architecture docs established.
  - Toolchain verified: Java 21, Maven 3.9.9, Node v24, npm 11, FFmpeg verified.
  - Remote status: `gh auth status` indicates unauthenticated host; local Git commits tracking progress.
- [x] **Phase 1 — Audio Ingestion and Normalization**
  - PCM representation (16-bit mono @ 11,025 Hz).
  - FFmpeg integration and validation tests (10 tests passing).
- [x] **Phase 2 — FFT and Spectral Analysis**
  - Custom Radix-2 Cooley-Tukey FFT in pure Java.
  - Hann windowing, STFT framing, 440 Hz peak validation tests (23 tests passing).
- [ ] **Phase 3 — Constellation Fingerprints**
  - Spectral peak extraction across logarithmic frequency bands.
  - Peak pairing and 32-bit integer hash encoding/decoding.
- [ ] **Phase 4 — PostgreSQL and Indexing**
  - Flyway migrations, database schema (`songs`, `fingerprints`).
  - Spring JDBC batched inserts, index query plans, integration tests.
- [ ] **Phase 5 — Matching Engine and REST API**
  - Time-coherent offset histogram candidate ranking.
  - REST endpoints for upload, indexing, search, stats, health.
- [ ] **Phase 6 — React Dashboard and Library**
  - Technical dark-mode UI, music library management, waveform visualization.
  - Interactive file search with match diagnostics and offset histograms.
- [ ] **Phase 7 — Live Microphone and WebSocket Streaming**
  - AudioWorklet PCM capture, WebSocket binary streaming, rolling query window.
- [ ] **Phase 8 — Noise Lab and Measured Robustness**
  - Controlled noise mixing, synthetic/licensed fixtures, repeatable benchmarks.
- [ ] **Phase 9 — Deployment, CI, and Final Quality Gate**
  - Multi-stage Docker builds, GitHub Actions CI workflow, complete documentation.

---

## Commit Log
| Phase | Commit | Message | Status |
|---|---|---|---|
| Phase 0 | `d64b5ce` | `chore: initialize EchoTrace project` | Complete |
| Phase 1 | `0e6f7b5` | `feat(audio): implement PCM normalization` | Complete |
| Phase 2 | `9bd30cd` | `feat(dsp): implement FFT and spectral analysis` | Complete |
| Phase 3 | Pending | `feat(fingerprint): generate constellation hashes` | Next |
