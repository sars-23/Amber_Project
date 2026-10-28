# Amber: Acoustic Fingerprinting & Real-Time Audio Search Engine

[![Amber CI Quality Gate](https://github.com/sars-23/Amber_Project/actions/workflows/ci.yml/badge.svg)](https://github.com/sars-23/Amber_Project/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Java 21 LTS](https://img.shields.io/badge/Java-21%20LTS-orange.svg)](https://adoptium.net/)
[![Spring Boot 3.3](https://img.shields.io/badge/Spring%20Boot-3.3-brightgreen.svg)](https://spring.io/projects/spring-boot)
[![PostgreSQL 16](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![TypeScript 6](https://img.shields.io/badge/TypeScript-6-3178C6.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF.svg)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC.svg)](https://tailwindcss.com/)

Amber is an acoustic fingerprinting and audio identification engine designed from first principles in **Java 21**, **Spring Boot**, and **React / TypeScript**.

Instead of delegating to third-party recognition APIs or external math libraries, Amber implements a custom **Radix-2 Cooley–Tukey Fast Fourier Transform (FFT)**, Short-Time Fourier Transform (STFT) spectral framing, logarithmic peak extraction, combinatorial constellation hashing, and time-coherent offset histogram matching backed by **PostgreSQL**.

> **Live Production Application:** [https://amber-frontend-w78m.onrender.com](https://amber-frontend-w78m.onrender.com)  
> **Backend Health Endpoint:** [https://amber-backend-ler4.onrender.com/api/v1/health](https://amber-backend-ler4.onrender.com/api/v1/health)

---

## Application Previews

| Live Microphone Recognition | Noise Lab In-Memory Benchmark |
| :---: | :---: |
| ![Live Microphone Recognition](docs/assets/live_microphone_recognition.png) | ![Noise Lab In-Memory Benchmark](docs/assets/noise_lab_benchmark.png) |
| *Real-time 11,025 Hz AudioWorklet streaming over WebSocket with interim matching* | *Isolated in-memory acoustic degradation testing with additive Gaussian noise* |

| Reference Music Library | Audio File Drag-and-Drop Search |
| :---: | :---: |
| ![Reference Music Library](docs/assets/music_library_catalog.png) | ![Audio File Drag-and-Drop Search](docs/assets/file_audio_search.png) |
| *B-tree indexed constellation catalog with admin-key authorization* | *Low-latency candidate retrieval and time-offset alignment (7–17ms measured)* |

---

## Key Capabilities

- **Pure Java Digital Signal Processing**: Hand-crafted decimation-in-time Radix-2 Cooley–Tukey FFT with precomputed periodic Hann windowing and zero external numeric dependencies.
- **Constellation Hashing**: Identifies prominent spectral peaks across 10 logarithmic frequency bands and forms forward anchor-target pairings encoded into compact 32-bit integers (`[Anchor 9b | Target 9b | DeltaT 6b]`).
- **Time-Coherent Offset Histogram Matching**: Evaluates time clustering ($\Delta t = t_{db} - t_{query}$) across candidates to accurately identify short audio snippets (down to 3 seconds) under severe acoustic degradation.
- **Live Browser Microphone Recognition**: Continuous 11,025 Hz mono PCM streaming via native Web Audio `AudioWorklet` downsamplers and bidirectional WebSockets.
- **Noise Lab Benchmark Suite**: An in-memory acoustic stress-testing harness that simulates real-world noise by mixing additive white Gaussian noise at configurable Signal-to-Noise Ratios (SNR from +50 dB down to -10 dB).
- **Administrative Write Protection**: Server-enforced authorization via `AMBER_ADMIN_API_KEY` with fail-closed verification, preventing unauthorized catalog mutations while keeping search and live recognition public.
- **Open Music Importer**: Search Jamendo's catalog for downloadable CC BY / CC BY-SA tracks and queue background ingestion through Amber's fingerprinting pipeline with bounded rate limiting and multi-instance restart recovery. *Note on licensing*: Track download permissions (`audiodownload_allowed=true`) and Creative Commons eligibility do not independently establish that bulk operational retention of derived fingerprints is permitted under Jamendo's platform terms; bulk ingestion must remain disabled operationally until platform use is confirmed. See [Open Music Importer Guide](docs/OPEN_MUSIC_IMPORTER.md) and [Jamendo API Terms](https://developer.jamendo.com/v3.0/legal/terms-of-use).
- **Rate-Limited Operational Safety**: Per-client bounded sliding-window rate limiting on compute-heavy benchmark endpoints with Render reverse-proxy client IP verification.

---

## Algorithmic Architecture & DSP Pipeline

```
 [ Audio File / Live Mic ]
            │
            ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 1. INGESTION & NORMALIZATION                                │
 │    FFmpeg / AudioWorklet -> 11,025 Hz 16-bit Mono PCM       │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 2. SPECTRAL FRAMING & FFT                                   │
 │    Periodic Hann Windowing (1024-sample frames, 50% overlap)│
 │    Radix-2 Cooley–Tukey DIT FFT -> Power Spectrum           │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 3. CONSTELLATION PEAK EXTRACTION                            │
 │    Logarithmic frequency sub-bands (adaptive energy floor)  │
 │    Local maximum selection (time & frequency neighbors)     │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 4. COMBINATORIAL HASH ENCODING                              │
 │    Forward anchor pairing (Δt in [1, 63] frames)            │
 │    Pack bits: (freq_anchor << 15) | (freq_target << 6) | Δt │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 5. POSTGRESQL LOOKUP & OFFSET HISTOGRAM MATCHING            │
 │    Batch lookup query hashes in B-Tree index                │
 │    Compute offset: Δt_offset = t_db - t_query               │
 │    Peak bucket voting -> Score & Confidence Evaluation      │
 └─────────────────────────────────────────────────────────────┘
```

### 1. Radix-2 Cooley–Tukey FFT & STFT Framing
Audio is normalized to $f_s = 11,025\text{ Hz}$, yielding a Nyquist frequency of $5,512.5\text{ Hz}$. A periodic Hann window of length $N = 1024$ samples with hop size $H = 512$ samples (50% overlap) produces a frame duration of $\approx 46.44\text{ ms}$ and a frequency resolution of $\approx 10.77\text{ Hz/bin}$.

### 2. Spectral Constellation Peaks
The frequency spectrum is partitioned into 10 logarithmic bands. Peaks are selected if their energy strictly exceeds immediate neighbors in both time ($\pm 2$ frames) and frequency ($\pm 2$ bins), and surpasses an adaptive threshold ($2.0\times$ frame mean).

### 3. Combinatorial Hashing
Anchor peaks are paired with subsequent peaks in a forward target zone ($dt \in [1, 63]$ frames). Each pair is packed bitwise into a single 32-bit integer:
$$\text{Hash} = (f_1 \ll 15) \mid (f_2 \ll 6) \mid (\Delta t \& 0\text{x}3F)$$

### 4. Offset Histogram Voting
When matching, candidate matches sharing identical hashes calculate time differentials:
$$\Delta t_{\text{offset}} = t_{\text{database}} - t_{\text{query}}$$
True matches cluster into a coherent time-offset bucket ($\Delta t_{\text{offset}} \approx \text{constant}$), while false collisions disperse uniformly across the noise floor.

---

## Technical Stack

| Layer | Technologies & Tools |
| :--- | :--- |
| **Backend Core** | Java 21 LTS, Spring Boot 3.3, Spring Web, Spring WebSocket, Spring JDBC |
| **Audio & Math** | Pure Java Radix-2 FFT, Hann Windowing, Alpine FFmpeg (Docker decoder) |
| **Persistence** | PostgreSQL 16 (Neon Serverless), Flyway Database Migrations, HikariCP |
| **Frontend Core** | React 19, TypeScript 6, Vite 5, Tailwind CSS 3.4, Lucide Icons |
| **Browser Audio** | Web Audio API, native `AudioWorklet` processor, HTML5 Canvas oscilloscope |
| **DevOps & Cloud** | Docker multi-stage builds, Render (Web Service & Static Site), GitHub Actions CI |

---

## Local Development Quickstart

### Prerequisites
- **Java 21 JDK** (e.g., Eclipse Temurin)
- **Maven 3.9+**
- **Node.js 20+** and **npm**
- **Docker & Docker Compose**
- **FFmpeg** installed and accessible on PATH

### 1. Clone Repository
```bash
git clone https://github.com/sars-23/Amber_Project.git
cd Amber_Project
```

### 2. Start PostgreSQL via Docker Compose
```bash
docker compose up -d postgres
```
*Flyway migrations will automatically initialize the database schema on backend startup.*

### 3. Run Backend (Spring Boot)
```bash
cd backend
mvn spring-boot:run
```
*The backend starts at `http://localhost:8080`. Health endpoint: `http://localhost:8080/api/v1/health`.*

### 4. Run Frontend (Vite)
```bash
cd ../frontend
npm install
npm run dev
```
*Access the user interface at `http://localhost:5173`.*

---

## Verified Test Results

Amber maintains comprehensive test suites with zero mocked mathematics in core DSP components:

```text
Backend Test Suite (Maven / Java 21):
-------------------------------------------------------
Tests run: 88, Failures: 0, Errors: 0, Skipped: 0
Execution Time: ~13.7 seconds (100% Passed)
  ├── com.amber.dsp (FFT, HannWindow, STFT, Peak Extraction)
  ├── com.amber.fingerprint (Constellation Hashing & Bit Packing)
  ├── com.amber.matching (Offset Histogram Voting & Scoring)
  ├── com.amber.benchmark (In-Memory Noise Degradation & Synthetic Audio)
  ├── com.amber.security (Admin Authentication & Bounded Rate Limiting)
  └── com.amber.ws (WebSocket Binary PCM Streaming & Session Limits)

Frontend Test Suite (Node.js 22 Native Test Runner):
-------------------------------------------------------
Tests run: 14, Failures: 0, Cancelled: 0, Skipped: 0
Execution Time: ~0.8 seconds (100% Passed)
  ├── Metadata Parsing from Filename Conventions
  ├── Audio File Extension & Size Validation
  ├── Duplicate Detection (Catalog & Batch)
  └── Memory & Time Formatter Utilities

Frontend Lint & Production Build:
-------------------------------------------------------
✓ OxLint: 0 errors across 20 source files
✓ Vite Build: 1,962 modules transformed, built in 4.11s
```

---

## Security & Operational Boundaries

1. **Fail-Closed Administrative Authorization**:
   - `POST /api/v1/songs` (track indexing) and `DELETE /api/v1/songs/{id}` require an administrative secret matching `AMBER_ADMIN_API_KEY`.
   - The backend fails closed: if `AMBER_ADMIN_API_KEY` is not configured on the server, all write operations return `HTTP 403 Forbidden`.
   - The secret is verified using constant-time `MessageDigest.isEqual` to prevent side-channel timing attacks.
   - The frontend never stores the admin key in `localStorage` or environment variables; administrators supply the key on-demand when performing catalogue maintenance.
2. **Benchmark Rate Limiting**:
   - `POST /api/v1/benchmark/robustness` enforces a per-client sliding-window rate limit of 10 requests per minute.
   - Storage is strictly bounded using an LRU cache (max 10,000 tracked clients) to prevent memory exhaustion attacks.
   - Resolves client identity from Render's reverse proxy by evaluating the rightmost token in `X-Forwarded-For`.
3. **WebSocket Concurrency Protection**:
   - WebSocket sessions are bounded to 50 concurrent active connections.
   - Each session uses a fixed 4-second circular buffer (44,100 samples / 88.2 KB), preventing unbounded memory growth.

---

## Known Limitations

- **Catalogue Scale**: The public production demo on Neon Serverless contains a curated sample catalogue (`saudebaazi` and `boro boro song`) to operate within serverless storage quotas.
- **Synthetic Reference in Noise Lab**: The default reference in the interactive Noise Lab uses an in-memory 12-second multi-tone acoustic symphony (`SyntheticAudioGenerator`) to ensure repeatable, deterministic evaluation without database queries. Users can optionally upload their own custom WAV/MP3 reference tracks up to 10 MB.
- **Free-Tier Cold Starts**: Render's free tier spins down the backend container after 15 minutes of inactivity. First requests after sleep may take ~30–50 seconds to boot the JVM and establish database connection pools.

---

## Detailed Documentation

- [Architecture & Modular Monolith Design](docs/ARCHITECTURE.md)
- [Algorithmic & Mathematical Specification](docs/ALGORITHM.md)
- [REST & WebSocket API Reference](docs/API.md)
- [Production Deployment Guide](docs/DEPLOYMENT.md)
- [Empirical Benchmarks & Noise Tolerance](docs/BENCHMARKS.md)

---

## License

This project is licensed under the [MIT License](LICENSE) — see the [LICENSE](LICENSE) file for details.
