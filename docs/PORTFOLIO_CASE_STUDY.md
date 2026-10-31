# Amber: Portfolio Engineering Case Study

## 1. Project Title & One-Line Summary
**Amber**: A high-performance acoustic music recognition platform engineered from first principles in **Java 21**, **Spring Boot**, **React / TypeScript**, and **PostgreSQL**, delivering sub-second audio identification through custom digital signal processing and time-coherent constellation matching.

---

## 2. Problem Statement
Commercial audio identification services (such as Shazam and SoundHound) perform acoustic fingerprinting at massive scale, yet their internal algorithmic implementations and signal processing pipelines are proprietary black boxes. Most open-source reproductions either:
1. Rely on heavy external Python numerical packages (`numpy`, `scipy`, `librosa`) that are unsuitable for low-latency Java web backends.
2. Delegate recognition to third-party APIs.
3. Implement naive Euclidean distance or cross-correlation searches that fail under ambient noise, microphone distortion, or tempo variations.

The challenge was to engineer an end-to-end, production-grade acoustic identification engine completely from scratch in Java, capable of sub-second search against millions of indexed fingerprints and resilient to physical microphone acoustic degradation.

---

## 3. Engineering Motivation
Building Amber directly in Java 21 without external mathematical dependencies served several architectural goals:
- **Zero-Dependency Core DSP**: Implement the Fourier transform, windowing functions, and peak extraction algorithms in pure Java, guaranteeing deep algorithmic mastery, zero external licensing baggage, and tight memory control.
- **Predictable Low-Latency Execution**: Utilize primitive arrays, precomputed trigonometric twiddle tables, and bitwise operations to minimize JVM garbage collection pressure during continuous streaming.
- **Relational Inverted Index**: Model the acoustic index directly inside PostgreSQL using standard composite B-Tree indexes, achieving high-throughput batch retrieval without requiring specialized vector databases.
- **Full-Stack Reactive Pipeline**: Bridge native browser Web Audio capture (`AudioWorklet` polyphase filtering) with a Spring WebSocket streaming backend.

---

## 4. Technical Architecture

Amber is architected as a **modular monolith** with clean bounded contexts:

```
                      +---------------------------------------+
                      |       Client Browser / Microphone      |
                      +---------------------------------------+
                                    |                 |
                    HTTPS (Assets)  |                 |  WSS / HTTPS (API)
                                    v                 v
                  +----------------------+   +-----------------------+
                  |  Render Static Site  |   |   Render Web Service  |
                  |   (amber-frontend)   |   |    (amber-backend)    |
                  +----------------------+   +-----------------------+
                                                         |
                                                         | JDBC over TLS (Port 5432)
                                                         v
                                             +-----------------------+
                                             |    Neon PostgreSQL    |
                                             |  (B-Tree Hash Index)  |
                                             +-----------------------+
```

### Component Layers
1. **Audio Ingestion (`com.amber.audio`)**: Normalizes input audio into canonical 11,025 Hz mono signed 16-bit linear PCM via Alpine FFmpeg or browser AudioWorklet.
2. **DSP Engine (`com.amber.dsp`)**: Precomputes periodic Hann windows, executes an in-place Radix-2 Cooley–Tukey FFT, and extracts local spectral peaks across 10 logarithmic frequency sub-bands.
3. **Constellation Fingerprinting (`com.amber.fingerprint`)**: Pairs anchor peaks with target peaks within a forward time zone ($\Delta t \in [1, 63]$ frames) and packs coordinates into 32-bit integer hashes.
4. **Relational Indexing (`com.amber.indexing`)**: Manages inverted fingerprint storage in PostgreSQL 16 on Neon, optimized with a composite B-Tree index on `(hash, song_id)`.
5. **Matching & Multi-Factor Acceptance (`com.amber.matching`)**: Computes time deltas ($\Delta t = t_{db} - t_q$) using independent query coordinates, scoring candidates through offset histogram concentration and 5 strict acceptance gates.
6. **Live Streaming (`com.amber.ws`)**: Manages bidirectional WebSocket connections with 4.0-second circular session buffers, streaming evaluations every 500 ms.
7. **Frontend Experience (`frontend/src`)**: React 19 and TypeScript 6 SPA with an interactive oscilloscope, Noise Lab degradation harness, and real-time developer diagnostics panel.

---

## 5. Key Implementation Challenges

### 5.1 Real-Time Browser Audio Capture & Resampling
Browser audio interfaces natively run at $44,100\text{ Hz}$ or $48,000\text{ Hz}$. Naive downsampling using linear interpolation or zero-order hold introduces severe high-frequency aliasing and harmonic smearing into the $0 - 5.5\text{ kHz}$ band.
- **Solution**: Engineered a 128-phase Blackman-windowed sinc polyphase FIR decimation filter with a 4,800 Hz cutoff directly in the `AudioWorklet` thread (`pcm-worker.js`). Stopband verification unit tests confirm $>50\text{ dB}$ attenuation across all 128 phases at discrete test frequencies (5,750, 6,000, 8,000, 12,000, and 16,000 Hz) for 44.1 kHz and 48 kHz inputs, and the pipeline incorporates a $20\text{ Hz}$ DC blocking IIR filter to eliminate hardware ADC offsets.

### 5.2 FFT Execution Speed Without Native Libraries
Computing thousands of discrete Fourier transforms per second during continuous live streaming could easily overwhelm the JVM without careful memory management.
- **Solution**: Implemented an in-place decimation-in-time Radix-2 Cooley–Tukey FFT. Reused real and imaginary work arrays across frames, precomputed bit-reversal permutation tables, and stored trigonometric twiddle factors in static lookup arrays. This eliminates per-frame heap allocations and costly trigonometric evaluations, achieving high-throughput microsecond-level transform times directly in pure Java without native C bindings or external mathematical libraries.

---

## 6. The Independent Query-Support Breakthrough

### The Cartesian Product Multiplication Flaw
During live testing with dense reference tracks (e.g., full songs with $>90,000$ fingerprints), genuine acoustic matches were repeatedly rejected with the diagnostic message:
```
GATE_3_COHERENCE_RATIO: Offset histogram scatter indicates random background hash collisions.
```
In an excerpt test of catalogue track 41 (`DJ Snake - Let Me Love You`) generating 1,352 total query fingerprints, candidate track 41 exhibited:
- **Candidate Distinct Query Support**: 775 distinct query points matched across the track.
- **Peak-Bucket Support**: 126 distinct query points aligned at offset $\Delta t = 29,900\text{ ms}$ (bounded by candidate distinct query support of 775 and query total of 1,352, not query frames).
- **Candidate Score**: 122.3 (dominant signal-to-noise separation).
- **Separation Margin**: 86.0% over runner-up.
- **Raw Pairwise Combinations**: **11,913 votes** ($N_q \times N_{db}$ cartesian pairings).
- **Flawed Coherence Ratio**: $\frac{126}{11,913} = 1.06\%$ ($< 5.0\%$ gate threshold).

**Root Cause**: In songs with repetitive musical motifs (repeated bass lines, drums, or choruses), hash $H$ appeared $N_q$ times in the query and $N_{db}$ times across the full 3.5-minute song. The matching loop nested over both lists:
```java
// Flawed implementation: Cartesian product
for (IndexedFingerprint candidate : candidates) {
    for (int qTime : queryTimesByHash.get(candidate.hash())) {
        histogram.addVote(candidate.anchorTimeMs() - qTime); // N_q * N_db votes!
    }
}
```
This Cartesian multiplication inflated the candidate's total matches into tens of thousands (11,913 raw pairings), while the true peak could never exceed the candidate's distinct query support ($N_{\text{peak}} \le N_{\text{candidate\_support}} \le N_{\text{query}}$). The coherence ratio was artificially suppressed, causing genuine matches to be falsely rejected as background scatter.

### The Architectural Resolution
Implemented **independent query evidence counting**:
1. Defined `QueryPoint(int hash, int anchorTimeMs)` to uniquely identify each query feature occurrence.
2. In `OffsetHistogram.java`, bucket votes are stored in `Map<Integer, Set<QueryPoint>> bucketQuerySupport`: a single query point can support an offset bucket at most once.
3. Candidate-wide distinct support is tracked in `Set<QueryPoint> uniqueQueryPoints`: each query point contributes at most once to the candidate's total matches.
4. Coherence ratio is calculated against distinct query evidence:
   $$\text{CoherenceRatio} = \frac{|\text{Peak Bucket QueryPoints}|}{|\text{Candidate Unique QueryPoints}|}$$
5. Raw pairwise combinations ($N_q \times N_{db} = 11,913$) are retained strictly as a diagnostic counter (`rawPairwiseVotes`).

**Result**: For the exact same recording, distinct candidate query support measured **775** (from 1,352 total query fingerprints), yielding a true coherence ratio of:
$$\text{CoherenceRatio} = \frac{126}{775} = 16.26\% \ge 5.0\%$$
The candidate passed all acceptance gates immediately with **94% confidence** (via the composite confidence heuristic), completely resolving false rejections without relaxing any false-positive security thresholds.

---

## 7. Multi-Factor False-Positive Protection

To guarantee that noise, speech, or unindexed music is never misidentified, candidates must pass 5 consecutive acceptance gates:

| Gate | Criterion | Threshold | Failure Mode & Rejection Rationale |
|---|---|---|---|
| **Gate 1: Peak Votes** | `winningPeakVotes` | $\ge 4$ | Rejects excerpts with fewer than 4 time-aligned acoustic feature pairs. |
| **Gate 2: Score** | `winningScore` | $\ge 3.0$ | Rejects matches where peak votes fail to exceed median background noise scatter. |
| **Gate 3: Coherence Ratio** | `coherenceRatio` | $\ge 0.05$ (5.0%) | Rejects random collisions dispersed uniformly across time offsets. |
| **Gate 4: Ambiguity Margin** | `margin` | $\ge 0.15$ (15.0%) | Rejects ties when two candidates exhibit comparable scores (margin $< 15\%$). |
| **Gate 5: Confidence** | `confidence` | $\ge 0.35$ (35.0%) | Rejects candidates whose composite peak/margin metric falls below acceptable certainty. |

When a candidate fails, `matched` remains strictly `false` and `song` is `null`. The backend populates `winningSongTitle` and `winningSongArtist` strictly inside the `diagnostics` payload, enabling safe developer observability without misrepresenting match results to end users.

---

## 8. Verification & Test Engineering

Amber enforces automated quality gates in GitHub Actions CI with zero external test mocking of DSP components:

| Test Suite | Framework / Tool | Test Count | Pass Rate | Scope Covered |
|---|---|---|---|---|
| **Backend Core** | JUnit 5 / AssertJ / Mockito / H2 | **212 tests** | **100%** | Radix-2 FFT, Hann window, STFT framing, 10-band peak extraction, 32-bit constellation hashing, independent query support, all 5 acceptance gates, WebSocket protocol, Jamendo queue concurrency. |
| **Frontend Core** | Node.js 22 Native Runner / TypeScript | **40 tests** | **100%** | 128-phase polyphase filter symmetry, stopband attenuation ($\ge 50\text{ dB}$), DC blocker, RMS calculations, duplicate catalogue detection, WebSocket protocol handling. |
| **Tools & Scripts** | Node.js 22 Native Runner | **34 tests** | **100%** | RFC-4180 CSV parser, preflight media integrity, fail-closed catalogue duplication safeguards, evaluation CLI. |
| **Total** | Multi-Environment CI | **286 tests** | **100%** | Complete end-to-end regression coverage across all three project tiers. |

---

## 9. Current Limitations & Production Constraints

- **Curated Demonstration Scale**: The live production catalogue hosted on Neon PostgreSQL contains a curated demonstration set (35 songs, 3,325,966 fingerprints as of snapshot dated 2026-10-31; live statistics accessible at `/api/v1/stats`) designed to operate within serverless storage quotas, rather than a commercial multi-million-track database.
- **Closed-World Domain**: Recognition identifies recordings represented in the catalogue. Unindexed music is correctly rejected by the false-positive gates.
- **Free-Tier Cold Starts**: Render's free tier idles container services after 15 minutes of inactivity; initial boot takes $\approx 30–50\text{ seconds}$ to initialize the JVM and HikariCP connection pool.
- **Jamendo Usage Boundary**: Creative Commons eligibility and download availability do not establish permission for bulk operational retention of derived fingerprints under Jamendo's platform terms; bulk ingestion remains disabled operationally.

---

## 10. Resume-Ready Content & Interview Preparation

### A. One-Line Resume Bullet
> *Architected an acoustic music recognition platform in Java 21, Spring Boot, React, and PostgreSQL, implementing custom Radix-2 Cooley–Tukey FFT, constellation hashing, and independent query-support offset histograms to achieve sub-second identification under severe noise.*

### B. Three Detailed Technical Resume Bullets
- **High-Performance Signal Processing**: Engineered a pure Java digital signal processing pipeline (Radix-2 Cooley–Tukey FFT, periodic Hann windowing, and 10-band logarithmic peak extraction) executing in-place 1,024-point transforms with zero per-frame allocation and zero external math dependencies.
- **Algorithmic Invariant & Combinatorial Hashing**: Designed a 32-bit forward-constellation hashing scheme and relational B-Tree inverted index in PostgreSQL, resolving a critical vote multiplication defect via independent query coordinates to achieve $7–17\text{ ms}$ in-memory algorithmic search latency.
- **Real-Time Full-Stack Streaming**: Built a continuous live microphone streaming pipeline utilizing a 128-phase Blackman-windowed sinc polyphase resampler in Web Audio `AudioWorklet`, streaming 11,025 Hz PCM frames over WebSockets to a Spring Boot circular session buffer with multi-factor false-positive rejection.

---

### C. 30-Second Elevator Pitch
> *"I built Amber, a real-time acoustic music recognition platform from first principles in Java 21 and React. Instead of relying on third-party APIs or Python packages, I implemented the complete DSP stack—including a Radix-2 Cooley–Tukey FFT, STFT framing, logarithmic spectral peak extraction, 32-bit constellation hashing, and offset histogram matching against PostgreSQL. It supports drag-and-drop audio search and live microphone streaming via an AudioWorklet polyphase resampler over WebSockets, identifying songs with sub-second database turnaround while enforcing 5 strict acceptance gates to eliminate false positives."*

---

### D. Two-Minute Technical Deep Dive
> *"Amber is an acoustic fingerprinting engine designed to solve the music identification problem without external math libraries.
>
> When an audio excerpt is captured—either via file upload or through a browser microphone—it is normalized to 11,025 Hz mono 16-bit PCM. In the browser, we accomplish this inside an AudioWorklet using a 128-phase Blackman-windowed sinc polyphase filter (4,800 Hz cutoff) that decimates 48 kHz hardware audio with over 50 dB stopband attenuation.
>
> On the backend, we compute a Short-Time Fourier Transform using 1,024-sample frames with 50% overlap and a periodic Hann window. We pass this through our in-place Radix-2 Cooley–Tukey FFT, utilizing precomputed twiddle factors and bit-reversal tables.
>
> From the resulting power spectrum, we extract prominent spectral peaks across 10 logarithmic frequency sub-bands, filtering points that exceed local time-frequency neighbors and an adaptive energy threshold. We then pair anchor peaks with target peaks in a forward time window of 1 to 63 frames, packing anchor frequency, target frequency, and delta time into a compact 32-bit integer hash.
>
> In PostgreSQL, we query our composite B-Tree index for matching hashes. To match candidates, we compute time deltas between database anchor timestamps and query anchor timestamps. The key insight is that true matches share a constant time offset, creating a tall vertical spike in an offset histogram, while random collisions disperse uniformly.
>
> One major engineering hurdle was resolving a Cartesian vote multiplication bug where repeated musical riffs multiplied votes to over 10,000, suppressing the coherence ratio below our 5% gate. We solved this by implementing independent query coordinates, ensuring each query point supports a bucket and candidate at most once.
>
> The engine evaluates 5 multi-factor acceptance gates—peak votes, coherence score, coherence ratio, ambiguity margin, and composite confidence—achieving robust identification down to +6 dB SNR."*

---

### E. Five Technical Interview Questions & Model Answers

#### Q1: What is the fundamental difference between an FFT and an STFT, and how does the uncertainty principle constrain audio fingerprinting?
**Answer**:
> *"The Fast Fourier Transform (FFT) computes the global frequency representation of an entire discrete signal, completely discarding temporal localization. For music recognition, knowing that 440 Hz was present in a song is useless without knowing **when** it occurred.
>
> The Short-Time Fourier Transform (STFT) introduces temporal localization by sliding an analysis window (such as a Hann window) across the audio signal and computing the FFT on successive overlapping frames.
>
> This is governed by the Gabor-Heisenberg uncertainty principle in signal processing: $\Delta t \cdot \Delta f \ge \frac{1}{4\pi}$. If we use a large window $N$, frequency resolution $\Delta f = \frac{f_s}{N}$ improves, but temporal resolution $\Delta t$ worsens, causing rapid note attacks to blur. If $N$ is too small, temporal resolution sharpens, but frequency bins become too wide to distinguish adjacent musical semitones.
>
> In Amber, we choose $f_s = 11,025\text{ Hz}$, $N = 1,024$, and hop size $H = 512$. This yields $\Delta f \approx 10.77\text{ Hz/bin}$ (sufficient to resolve musical pitches down to the lower octaves) and $\Delta t \approx 46.44\text{ ms/frame}$ (sufficient to track fast percussive transients)."*

#### Q2: Why pair spectral peaks into combinatorial constellation hashes rather than indexing single frequency peaks?
**Answer**:
> *"If you index individual spectral peaks $(f_1, t_1)$, frequency bins from $0$ to $511$ have high collision entropy. In a database of 100,000 songs, common musical notes (like $A_4 \approx 440\text{ Hz}$) appear millions of times, forcing the database to scan enormous candidate lists and destroying retrieval specificity.
>
> Combinatorial constellation hashing pairs an anchor peak $P_1 = (f_1, t_1)$ with a target peak $P_2 = (f_2, t_2)$ within a forward target zone ($\Delta t \in [1, 63]$ frames). By encoding the tuple $(f_1, f_2, \Delta t)$ into a 24-bit compact hash, the entropy space expands from $2^9 = 512$ bins to $2^9 \times 2^9 \times 2^6 = 16,777,216$ possible hash keys.
>
> This dramatically reduces false collision rates by orders of magnitude while preserving translation invariance: even if a query excerpt starts at minute 2 instead of minute 0, the relative frequency and time differentials between paired peaks remain identical."*

#### Q3: How does offset histogram matching establish temporal coherence, and why is it invariant to query excerpt position?
**Answer**:
> *"When a query excerpt is recorded from an unknown position in an indexed track, every matching query feature $(h, t_q)$ corresponds to a database occurrence $(h, t_{db})$. If the query excerpt was recorded starting at offset $T_{\text{start}}$ in the track, then for all genuine features:
> $$t_{db} \approx t_q + T_{\text{start}} \implies \Delta t_{\text{offset}} = t_{db} - t_q \approx T_{\text{start}}$$
> Because $T_{\text{start}}$ is constant across the entire excerpt, all true acoustic matches vote for the exact same $100\text{ ms}$ histogram bucket centered at $T_{\text{start}}$.
>
> In contrast, background noise, unrelated songs, or random harmonic coincidences produce scattered timestamps where $t_{db} - t_q$ is uniformly distributed across the entire duration of the song. By identifying the dominant peak in the histogram and subtracting the median noise floor of the remaining buckets, we evaluate time-coherent signal prominence regardless of where the snippet was cropped."*

#### Q4: How does Amber prevent false-positive identifications on unindexed songs or ambient noise?
**Answer**:
> *"Amber avoids false positives by enforcing a multi-factor acceptance engine with 5 sequential gates before any match is confirmed:
> 1. **Peak Votes ($\ge 4$)**: Rejects queries that do not have at least 4 acoustic feature pairs agreeing on the exact same $100\text{ ms}$ time alignment.
> 2. **Coherence Score ($\ge 3.0$)**: Requires the peak bucket votes minus the median background scatter noise, boosted by coherence ratio, to exceed 3.0.
> 3. **Coherence Ratio ($\ge 5.0\%$)**: The dominant peak bucket must account for at least 5% of all distinct query features that matched that candidate, filtering out wide-scatter noise collisions.
> 4. **Ambiguity Margin ($\ge 15.0\%$)**: If a runner-up candidate is non-trivial (score $\ge 2.0$), the winner must lead by at least 15% relative margin: $\frac{S_1 - S_2}{S_1} \ge 0.15$.
> 5. **Composite Confidence ($\ge 35.0\%$)**: A balanced metric combining peak prominence and separation margin must exceed 0.35.
>
> If any gate fails, `matched` returns `false` and `song` returns `null`. The backend exposes diagnostic metadata (such as the leading rejected candidate's title and rejection gate) for developer observability without falsely declaring a positive match."*

#### Q5: What is the vote multiplication defect in offset histogram matching, and how do independent query coordinates solve it?
**Answer**:
> *"The vote multiplication defect occurs when a candidate song has repeated musical structures (such as a recurring bass riff, kick drum, or chorus). If hash $H$ appears $N_q$ times in the query and $N_{db}$ times in the database song, a naive nested loop accumulates $N_q \times N_{db}$ votes for that candidate.
>
> In our production tests on songs with $>90,000$ fingerprints, this Cartesian product inflated total candidate votes to 11,913, even though the query only contained 1,352 total fingerprints. Because the true peak bucket support can never exceed the candidate's distinct query support ($N_{\text{peak}} \le N_{\text{candidate\_support}} \le N_{\text{query}}$)—measuring 126 distinct query features for the winning bucket—calculating coherence ratio as $\frac{\text{Peak}}{\text{Total Pairwise}}$ yielded $\frac{126}{11,913} = 1.06\%$, failing the 5% coherence gate and falsely rejecting genuine songs. Note that 126 is the peak bucket's distinct query support, not the count of query frames.
>
> We solved this by implementing independent query coordinates:
> - Each query occurrence is tracked as a distinct coordinate: $\text{QueryPoint} = (\text{hash}, t_q)$.
> - Inside `OffsetHistogram`, each bucket stores a `Set<QueryPoint>`: a single query feature can support an offset bucket at most once.
> - The candidate maintains a global `Set<QueryPoint>`: a single query feature can contribute at most once to the candidate's total distinct query support.
>
> This bounds the denominator to the actual number of distinct query features that matched the candidate (775 distinct query support out of 1,352 query fingerprints, rather than 11,913 raw pairings). The coherence ratio measured $\frac{126}{775} = 16.26\%$, passing the 5% gate and identifying the song with 94% confidence under our multi-factor scoring heuristic."*
