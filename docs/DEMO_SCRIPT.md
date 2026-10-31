# Amber: Professional Portfolio Demonstration Script

This script provides a structured, 3 to 5-minute technical demonstration of Amber for technical recruiters, engineering managers, and systems architects.

---

## Demonstration Overview

| Time Interval | Segment Title | Core Engineering Concept Demonstrated |
|---|---|---|
| **0:00 – 0:30** | Introduction & Problem Scope | First-principles DSP, zero external math libraries, acoustic search. |
| **0:30 – 1:15** | Audio File Drag-and-Drop | STFT, constellation peak extraction, sub-second B-Tree lookup. |
| **1:15 – 2:15** | Live Microphone Stream | Web Audio AudioWorklet, polyphase downsampling, WebSocket matching. |
| **2:15 – 2:45** | False-Positive Protection | 5-stage acceptance gates, background scatter noise rejection. |
| **2:45 – 3:30** | Music Library & Importers | B-Tree inverted index, duplicate detection, Jamendo licensing caveats. |
| **3:30 – 4:30** | Noise Lab & Core DSP | Additive Gaussian noise degradation, Radix-2 FFT, offset histograms. |
| **4:30 – 5:00** | Architecture & Closing | Modular monolith, Neon PostgreSQL, cloud deployment on Render. |

---

## Segment-by-Segment Script

### 0:00 – 0:30 — Introduction & Core Distinction
**Spoken Narration**:
> *"Hello! Today I'm demonstrating **Amber**, an acoustic fingerprinting and real-time music recognition platform. Most modern audio projects delegate signal processing to external Python services or pre-trained neural networks. Amber was built from first principles in **Java 21**, **Spring Boot**, and **React with TypeScript**.*
>
> *From the Radix-2 Cooley–Tukey FFT and STFT spectral framing to 32-bit constellation hashing and independent query-support offset histograms, every mathematical component is implemented directly in pure Java with zero external numeric libraries. Let's look at the live application running on Render and Neon PostgreSQL."*

**Visual Action**:
1. Open the production frontend: [`https://amber-frontend-w78m.onrender.com`](https://amber-frontend-w78m.onrender.com).
2. Point out the live status indicator confirming backend connectivity.

> [!TIP]
> **Cold-Start Fallback**: If Render's free tier has spun down the container, the health check will take $\approx 30\text{ seconds}$. Explain: *"Render's free tier idles containers after 15 minutes of inactivity; while the JVM initializes and Flyway verifies our schema, let's review the architectural diagram."* Use [`docs/assets/file_audio_search.png`](assets/file_audio_search.png) as a visual backup.

---

### 0:30 – 1:15 — Audio File Drag-and-Drop Search
**Spoken Narration**:
> *"First, let's identify an unknown audio excerpt. I'll drop a 10-second snippet of a track into the search box."*

**Visual Action**:
1. Click the **Search** tab.
2. Drag and drop an audio file (e.g. an excerpt of `DJ Snake - Let Me Love You` or `Ed Sheeran - Sapphire`).
3. Click **Identify Audio**.

**Expected Result**:
- The match card renders the identification results:
  - Title: `DJ_Snake_-_Let_Me_Love_You_(Official_Music_Video)_ft._Justin_Bieber`
  - Confidence: `94%` (or score heuristic returned for the excerpt)
  - Estimated Offset: `29.9s`
  - Algorithmic Search Latency: (Show the actual latency reported by the running application)
- The **Offset Histogram** chart renders a dominant vertical spike at $29,900\text{ ms}$, with flat noise scatter across other buckets.

**Technical Callout**:
> *"Notice the latency reported directly by the running application in the match card: algorithmic lookup in the B-Tree index and offset histogram evaluation execute dynamically based on candidate volume. The offset histogram visualizes the core algorithmic invariant: when identical constellation hashes align at a constant time delta between query and database ($t_{db} - t_q \approx \text{constant}$), votes cluster into a single dominant bucket while random background collisions disperse uniformly."*

---

### 1:15 – 2:15 — Live Microphone Recognition
**Spoken Narration**:
> *"Now let's test real-time microphone recognition. This requires continuous browser audio capture, live downsampling, and WebSocket communication."*

**Visual Action**:
1. Click the **Live Recognition** tab.
2. Select your microphone input device from the dropdown.
3. Click **Start Listening**.
4. Play an indexed track through your smartphone or external speakers.

**Expected Result**:
- The HTML5 canvas oscilloscope animates real-time audio waveforms.
- RMS level meter shows incoming signal (e.g. `RMS: -22 dBFS`, `Peak: 38%`, `Clipping: 0%`).
- Within $2\text{ seconds}$, interim evaluations stream every $500\text{ ms}$:
  - Step 1: `Listening to ambient audio... (Accumulating spectral features)`
  - Step 2: **`MATCH IDENTIFIED`** banner turns emerald green, revealing track metadata and continuous confidence updates.
5. Click **Developer Matching Diagnostics** to expand the live metrics:
  - Show `Winning Peak Votes: 25–126`
  - Show `Total Winning Votes: 200–775 distinct query points`
  - Show `Coherence Ratio: 10%–18%` (comfortably above the $5.0\%$ gate).

**Technical Callout**:
> *"Inside the browser, our custom AudioWorklet runs a 128-phase Blackman-windowed sinc polyphase resampler (4,800 Hz cutoff) to decimate hardware 48 kHz audio down to 11,025 Hz signed 16-bit PCM. The browser streams 4 KB binary frames over a TLS WebSocket. The backend maintains a rolling 4-second circular buffer, generating candidate evaluations every 500 milliseconds without allocating memory on every frame."*

---

### 2:15 – 2:45 — False-Positive Protection
**Spoken Narration**:
> *"A music recognition engine is only as good as its ability to reject unindexed audio. Let's see what happens when we play an unindexed song or make random room noise."*

**Visual Action**:
1. While listening, speak or play an unindexed recording or ambient white noise.
2. Observe the Developer Matching Diagnostics panel.

**Expected Result**:
- The UI displays: `"Listening to ambient audio..."` or `"Match rejected: Insufficient time-coherent votes"`.
- Rejection Gate: `GATE_1_PEAK_VOTES` or `GATE_3_COHERENCE_RATIO`.
- `matched` remains strictly `false`; no false-positive song is declared.

**Technical Callout**:
> *"Notice that Amber never guesses. Our multi-factor acceptance engine enforces 5 sequential gates: minimum peak votes ($\ge 4$), coherence score ($\ge 3.0$), coherence ratio ($\ge 5\%$), ambiguity margin ($\ge 15\%$), and composite confidence ($\ge 35\%$). If any gate fails, the candidate is rejected. Notice also our developer observability: the diagnostics panel safely reveals the leading candidate and rejection gate for debugging without declaring a false match."*

---

### 2:45 – 3:30 — Music Library & Importers
**Spoken Narration**:
> *"Let's explore the reference music catalogue and how tracks are ingested."*

**Visual Action**:
1. Click the **Library** tab.
2. View the paginated list of indexed songs (displaying 35 tracks and ~3.32M fingerprints as of snapshot dated 2026-10-31; live catalogue metrics accessible at `/api/v1/stats`).
3. Click the **Bulk Importer** tab. Show how filenames are automatically parsed into metadata, validated against limits, and checked for duplicates.
4. Click the **Open Music** tab. Show the Jamendo search interface.

**Technical Callout & Licensing Disclaimer**:
> *"The catalogue is stored in Neon PostgreSQL with a composite B-Tree index on `(hash, song_id)`. Administrative operations like indexing and deletion require constant-time verification against `AMBER_ADMIN_API_KEY`. In the Open Music tab, we can search Creative Commons music from Jamendo. Importantly, from an engineering governance perspective, track download availability under Creative Commons does not automatically establish permission for bulk operational retention of derived fingerprints under Jamendo's platform terms, so bulk ingestion remains intentionally disabled operationally in production until explicit authorization is established."*

---

### 3:30 – 4:30 — Noise Lab & Core DSP Deep Dive
**Spoken Narration**:
> *"Finally, let's explore **Noise Lab**, an interactive in-memory test bench designed to measure recognition degradation under extreme noise conditions."*

**Visual Action**:
1. Click the **Noise Lab** tab.
2. Set the Signal-to-Noise Ratio (SNR) slider to `+20 dB`, then click **Run Robustness Benchmark**.
3. Observe the deterministic benchmark metrics returned by the server: because `RobustnessBenchmarkService` uses a fixed random seed (`1337`), synthesized noise is fully reproducible (`Offset Error: 100 ms`, `Confidence: 1.0`, and `155 Peak Votes` for the default 12-second reference at $+20\text{ dB}$ SNR).
4. Lower the slider to `+6 dB` (high noise environment) and re-run.
5. Point out that the engine still achieves `100 ms` offset accuracy and high confidence ($>80\%$) despite severe synthetic corruption.

**Technical Callout**:
> *"Noise Lab runs entirely in-memory without database queries. It synthesizes additive white Gaussian noise at exact decibel ratios:
> $$\text{SNR}_{\text{dB}} = 10 \log_{10}\left(\frac{P_{\text{signal}}}{P_{\text{noise}}}\right)$$
> Because our spectral peak extraction partitions the spectrum into 10 logarithmic frequency sub-bands with adaptive local thresholding ($2.0\times$ frame mean), dominant acoustic harmonics survive even when noise energy approaches the musical signal."*

---

### 4:30 – 5:00 — Architecture Summary & Closing
**Spoken Narration**:
> *"To summarize the architecture:*
> - *Frontend: React 19, TypeScript 6, Vite, and native Web Audio AudioWorklet.*
> - *Backend: Java 21 LTS modular monolith with Spring Boot 3.3.4.*
> - *Persistence: Neon Serverless PostgreSQL with Flyway migrations.*
> - *Testing: 212 backend tests, 40 frontend tests, and 34 script tests with 100% pass rate in GitHub Actions CI.*
> - *Production: Deployed across Render and Neon.*
>
> *Amber demonstrates how high-throughput digital signal processing and low-latency database search can be engineered cleanly from first principles. Thank you! I'd be happy to answer any questions about the DSP mathematics or system architecture."*
