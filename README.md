# Amber: Acoustic Fingerprinting & Real-Time Audio Search Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Java 21](https://img.shields.io/badge/Java-21-orange.svg)](https://adoptium.net/)
[![Spring Boot 3](https://img.shields.io/badge/Spring%20Boot-3.3-brightgreen.svg)](https://spring.io/projects/spring-boot)
[![React 19](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev/)

Amber is a production-minded acoustic fingerprinting and audio search engine built from first principles in Java 21, Spring Boot, and React/TypeScript.

Instead of utilizing black-box third-party music recognition APIs, Amber implements a pure Java **Radix-2 Cooley-Tukey Fast Fourier Transform (FFT)**, Short-Time Fourier Transform (STFT) spectral framing, logarithmic peak extraction, constellation pairing into 32-bit integer hashes, and time-coherent offset histogram matching over PostgreSQL.

---

## Key Features

- **Custom Radix-2 Cooley–Tukey FFT**: Decimation-in-time pure Java FFT with precomputed periodic Hann windowing and zero external math libraries.
- **Constellation Hashing**: Robust spectral peak detection across logarithmic frequency bands paired forward in time into compact 32-bit hashes (`[Anchor 9b | Target 9b | DeltaT 6b]`).
- **PostgreSQL & Spring JDBC Indexing**: High-performance batch insertion and sub-50ms candidate fingerprint lookups via B-tree indexed hashes.
- **Offset Histogram Matching**: Evaluates time-coherent clustering ($\Delta t = t_{db} - t_q$) to accurately identify recordings from short excerpts (down to 3 seconds) with high noise tolerance.
- **Modern React & TypeScript Dashboard**: Audio spectrum visualizer, song library management, drag-and-drop search, and real-time histogram graphs.
- **Live Microphone Recognition**: Low-latency PCM streaming via AudioWorklet and native WebSockets.
- **Interactive Noise Lab**: Demonstrates recognition robustness with adjustable SNR white/ambient noise mixing directly in the browser.

---

## Architecture at a Glance

```text
Audio File / Stream -> Normalizer (FFmpeg -> 11,025 Hz 16-bit PCM)
                   -> Hann Window + Radix-2 FFT (1024-pt, 50% overlap)
                   -> Spectral Peak Extractor (Log Frequency Bands)
                   -> Constellation Pairing -> 32-bit Hashes
                   -> PostgreSQL Index / Candidate Search
                   -> Time-Offset Histogram Peak Voting -> Match Result
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ALGORITHM.md](docs/ALGORITHM.md) for full details.

---

## Quickstart (Local Development)

### Prerequisites
- Java 21 JDK
- Maven 3.9+
- Node.js 18+ and npm
- Docker & Docker Compose (optional, for containerized run)
- FFmpeg on PATH (or configure `AMBER_FFMPEG_PATH`)

### Running with Docker Compose
```bash
docker compose up --build
```
Access the application at `http://localhost:3000`.

### Running Locally
1. Start PostgreSQL:
   ```bash
   docker compose up -d postgres
   ```
2. Start the Backend:
   ```bash
   cd backend
   mvn spring-boot:run
   ```
3. Start the Frontend:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

---

## API & Deployment Documentation
- API Documentation: [docs/API.md](docs/API.md)
- Production Deployment (Vercel, Render, Neon): [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

---

## License
MIT
