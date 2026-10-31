# Amber: Benchmarks & Empirical Robustness Measurements

## 1. Distinct Evaluation Paradigms

Amber's performance and robustness are evaluated across three distinct evaluation environments:

1. **Synthetic In-Memory Noise Lab (`RobustnessBenchmarkService`)**: An isolated, in-memory test harness measuring algorithmic feature survival under additive white Gaussian noise at controlled Signal-to-Noise Ratios (SNR).
2. **Production Database Matching (`AudioMatchingService`)**: The live production search engine performing batch B-Tree candidate retrieval against PostgreSQL, deduplicating independent query coordinates, and evaluating five sequential acceptance gates.
3. **Physical Microphone Over-the-Air Validation**: Empirical tests measuring real-world room acoustic capture through physical hardware microphones.

> [!IMPORTANT]
> **Key Architectural Distinctions**:
> - **In-Memory Benchmark Latency vs. Database Search Latency**: Noise Lab's execution timer measures the total duration of in-memory synthetic processing—including reference audio slicing, Gaussian noise generation, query STFT/FFT fingerprint extraction, and local hash-map voting. It **does not query PostgreSQL** and must not be confused with database candidate retrieval latency.
> - **Heuristic Confidence Metric**: Confidence in both engines is a deterministic heuristic scoring metric, not a statistically calibrated Bayesian posterior probability. Furthermore, Noise Lab calculates confidence using single-track score prominence, whereas production matching calculates confidence using competitive runner-up separation margin.
> - **Synthetic vs. Production Acceptance**: Passing the in-memory Noise Lab benchmark at a given SNR demonstrates that spectral constellation peaks survived additive Gaussian noise; it **does not establish** that the query would pass all five production acceptance gates (which evaluate candidate separation and coherence ratios against a multi-track catalogue).

---

## 2. In-Memory Synthetic Noise Benchmarks (Noise Lab)

Evaluated via `RobustnessBenchmarkService` using the built-in 12.0s multi-tone acoustic master recording at $11,025\text{ Hz}$ ($132,300\text{ PCM samples}$) and a $4.0\text{ s}$ query excerpt cropped at ground-truth offset $t_{\text{true}} = 3,000\text{ ms}$:

| Condition / SNR | Benchmark Matched? | Estimated Offset | Ground Truth | Offset Error | Peak Votes | Benchmark Confidence | In-Memory Execution Time |
|---|---|---|---|---|---|---|---|
| **Clean ($\infty$ dB)** | **YES** | **3,100 ms** | 3,000 ms | **100 ms** | 277 | **1.00** | **7 ms** |
| **+20 dB SNR** | **YES** | **3,100 ms** | 3,000 ms | **100 ms** | 155 | **1.00** | **7 ms** |
| **+10 dB SNR** | **YES** | **3,100 ms** | 3,000 ms | **100 ms** | 70 | **1.00** | **11 ms** |
| **+6 dB SNR** | **YES** | **2,900 ms** | 3,000 ms | **100 ms** | 23 | **0.88** | **16 ms** |
| **0 dB SNR (1:1 noise)** | **YES** | **2,200 ms** | 3,000 ms | 800 ms* | 4 | **0.57** | **17 ms** |

### Benchmark In-Memory Mechanics
- **Local Hash-Map Lookup**: Reference fingerprints are indexed into a `Map<Integer, List<Integer>>` in JVM heap memory.
- **Pairwise Accumulation**: Votes are accumulated directly via `OffsetHistogram.addVote(refTime - queryTime)`. This isolated harness does not exercise the production database or candidate-wide independent query support deduplication.
- **Two-Threshold Acceptance**: Noise Lab confirms a match if $\text{PeakVotes} \ge 4$ and $\text{Score} \ge 3.0$. It does not evaluate candidate separation margin or coherence ratios because no competing songs exist in memory.
- **Benchmark Confidence Formula**:
  $$\text{Confidence}_{\text{benchmark}} = 0.50 \cdot \left(\frac{\text{PeakVotes}}{\max(\text{PeakVotes}, 30)}\right) + 0.50 \cdot \min\left(1.0, \frac{\text{Score}}{10.0}\right)$$
- **Offset Resolution**: STFT hop size of 512 samples at $11,025\text{ Hz}$ yields frame intervals of $\approx 46.44\text{ ms}$. With $100\text{ ms}$ histogram buckets, an offset error of $100\text{ ms}$ represents within 2 frames. At $0\text{ dB}$ SNR (noise power equal to signal power), low-frequency noise perturbations cause temporal dispersion in the dominant bucket.

---

## 3. Production Database Matching Performance

In production (`AudioMatchingService`), matching operates against the persistent PostgreSQL catalogue (snapshot of 35 tracks and ~3.32M fingerprints as of October 2026; live statistics queryable via `GET /api/v1/stats`).

### Full Production Matching Engine
- **Database Query**: Queries composite B-Tree index on `(hash, song_id)` via Spring JDBC:
  ```sql
  SELECT hash, song_id, anchor_time_ms FROM fingerprints WHERE hash IN (...)
  ```
- **Independent Query Support**: Each query feature occurrence is identified as $q = (\text{hash}, t_q)$. Votes in any offset bucket and candidate-wide totals are strictly bounded by distinct query features, preventing Cartesian vote multiplication on repetitive motifs.
- **Five Multi-Factor Acceptance Gates**:
  1. `Peak Votes` $\ge 4$
  2. `Coherence Score` $\ge 3.0$
  3. `Coherence Ratio` $\ge 5.0\%$ of candidate unique query support
  4. `Ambiguity Margin` $\ge 15.0\%$ relative separation over runner-up
  5. `Composite Confidence` $\ge 35.0\%$
  *(Plus post-acceptance database integrity verification `GATE_6_CATALOGUE_NOT_FOUND`)*
- **Production Confidence Formula**:
  $$\text{Confidence}_{\text{production}} = 0.50 \cdot \min\left(1.0, \frac{\text{PeakVotes}}{30}\right) + 0.50 \cdot \min\left(1.0, \text{Margin}\right)$$
- **Latency Factors & Runtime Diagnostics**:
  Observed recognition latency is not a static constant; it varies dynamically based on:
  1. **Input Excerpt Length & Feature Density**: Longer query snippets or musically dense sections extract more constellation hashes, scaling both database query parameter lists and candidate evaluation loops.
  2. **Database Engine & Connection Pool State**: Neon serverless compute state (active vs. waking compute), connection pool acquisition overhead, and PostgreSQL buffer cache hit rates.
  3. **Candidate Volume & Selectivity**: The number of matching candidate fingerprints retrieved for the query hashes across the reference catalogue.
  4. **Network & Ingestion Overhead**: Client-to-server TLS latency, file upload transfer time, and FFmpeg audio container decoding inside the backend container.
  
  Because no fixed static range can accurately capture all query lengths, network topologies, and cold-start conditions, Amber exposes real-time measurement diagnostics directly in API responses (`executionTimeMs`) and in the frontend **Developer Matching Diagnostics** panel (`Latency`, `Query Fingerprints`, `Candidate Rows`). Production users and evaluators should inspect these runtime diagnostic measurements for their specific deployment environment and query inputs.

---

## 4. Physical Microphone Over-the-Air Validation

A physical over-the-air test was recorded in a typical home office environment to evaluate real-world acoustic transfer characteristics (loudspeaker coloration, ambient room reverberation, and hardware microphone ADC response).

### Test Setup & Recording Conditions
- **Recording Hardware**: Built-in Realtek ALC294 microphone on a laptop, capturing audio played through external desktop monitor speakers placed ~0.8 meters away.
- **Audio Stream**: Captured at $48,000\text{ Hz}$ mono, processed through the browser `AudioWorklet` 128-phase Blackman-windowed sinc polyphase filter (4,800 Hz cutoff) down to $11,025\text{ Hz}$ mono signed 16-bit PCM.
- **Signal Metrics**: Microphone RMS $-22.5\text{ dBFS}$, Peak Amplitude 42%, Clipping 0%, Zero samples 0%.
- **Audio Material**: A 10.0-second physical microphone recording of catalogue Song ID 41 (`DJ Snake - Let Me Love You`).

### Empirical Results for this Test Recording

| Diagnostic Parameter | Observed Value | Production Acceptance Gate | Evaluation |
|---|---|---|---|
| **Acoustic Match Result** | **`matched = true`** | `true` | **CONFIRMED** |
| **Identified Catalogue Song** | **Song ID 41** | Expected Catalogue Track | **ACCURATE** |
| **Winning Peak Votes** | **126 votes** | $\ge 4$ (Gate 1) | **PASS** |
| **Coherence Score** | **140.7** | $\ge 3.0$ (Gate 2) | **PASS** |
| **Distinct Candidate Support** | **775 query points** | Bounded denominator | **INDEPENDENT** |
| **Raw Pairwise Combinations** | **11,913 combinations** | Retained for diagnostics | **BOUNDED** |
| **Coherence Ratio** | **16.26%** | $\ge 5.0\%$ (Gate 3) | **PASS** |
| **Separation Margin** | **86.0%** (Runner-up score: 17.1) | $\ge 15.0\%$ (Gate 4) | **PASS** |
| **Composite Confidence** | **0.94** (Heuristic metric) | $\ge 0.35$ (Gate 5) | **PASS** |
| **Estimated Track Offset** | **29,900 ms** ($\approx 29.9\text{ s}$) | $\approx 30.0\text{ s}$ Ground Truth | **ACCURATE ($\le 100\text{ ms}$)** |

> [!NOTE]
> These physical microphone results represent empirical measurements from this specific recording session and hardware environment. They illustrate real-world feature survival but do not constitute a universal performance guarantee across all possible hardware, room reverberations, or extreme signal-to-noise ratios.

---

## 5. False-Positive & Negative Control Testing

To verify rejection immunity against false alarms, negative controls were evaluated against the 35-track catalogue snapshot:

| Test Input | Input Characteristics | Expected Result | Actual Result | Rejection Gate |
|---|---|---|---|---|
| **White Gaussian Noise** | Pure synthetic noise, 3.0s | `matched = false` | `matched = false` | `GATE_1_PEAK_VOTES` / `GATE_3_COHERENCE_RATIO` |
| **Unindexed Pop Song** | Clean 10s excerpt not in catalogue | `matched = false` | `matched = false` | `GATE_1_PEAK_VOTES` (Scatter $< 4$ votes) |
| **Ambient Silence / Room Noise** | Mic noise floor $-48\text{ dBFS}$ | `matched = false` | `matched = false` | `INSUFFICIENT_FEATURES` |
| **Ambiguous Candidates** | Synthetic chord equally present in 2 songs | `matched = false` | `matched = false` | `GATE_4_AMBIGUITY` (Margin $< 15\%$) |
