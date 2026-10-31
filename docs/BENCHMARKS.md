# Amber: Benchmarks & Empirical Robustness Measurements

## 1. Evaluation Methodology

Acoustic recognition performance is evaluated across two distinct environments:
1. **In-Memory Synthetic Benchmarks**: Deterministic, reproducible evaluation measuring algorithmic noise degradation using additive white Gaussian noise at controlled Signal-to-Noise Ratios (SNR).
2. **Physical Microphone Over-the-Air Tests**: Real-world acoustic evaluations capturing room reverberation, hardware ADC non-linearities, loudspeaker distortions, and ambient background noise.

> [!IMPORTANT]
> **Understanding Latency Metrics**:
> - **Algorithmic Search Latency ($7 - 17\text{ ms}$)**: Measures pure backend processing time: STFT execution, spectral peak extraction, 32-bit constellation pairing, PostgreSQL B-Tree batch retrieval, and offset histogram scoring.
> - **End-to-End Recognition Latency ($300 - 800\text{ ms}$)**: Measures full browser-to-backend roundtrip, including AudioWorklet polyphase filtering, WebSocket network transport over TLS, and UI rendering.
>
> **Understanding Confidence**:
> The `confidence` score ($0.0 \dots 1.0$) is a **deterministic heuristic composite metric** combining dominant peak prominence ($\frac{\text{PeakVotes}}{30}$) and candidate separation margin. It is not a statistically calibrated Bayesian posterior probability.

---

## 2. In-Memory Synthetic Noise Benchmarks

Evaluated using a 12.0s multi-tone acoustic master recording at $11,025\text{ Hz}$ ($132,300\text{ PCM samples}$) and a $4.0\text{ s}$ query excerpt cropped at ground-truth offset $t_{\text{true}} = 3,000\text{ ms}$:

| Condition / SNR | Matched? | Estimated Offset | Ground Truth | Offset Error | Peak Votes | Confidence Score | Algorithmic Latency |
|---|---|---|---|---|---|---|---|
| **Clean ($\infty$ dB)** | **YES** | **3,100 ms** | 3,000 ms | **100 ms** | 277 | **1.00** | **7 ms** |
| **+20 dB SNR** | **YES** | **3,100 ms** | 3,000 ms | **100 ms** | 155 | **1.00** | **7 ms** |
| **+10 dB SNR** | **YES** | **3,100 ms** | 3,000 ms | **100 ms** | 70 | **1.00** | **11 ms** |
| **+6 dB SNR** | **YES** | **2,900 ms** | 3,000 ms | **100 ms** | 23 | **0.88** | **16 ms** |
| **0 dB SNR (1:1 noise)** | **YES** | **2,200 ms** | 3,000 ms | 800 ms* | 4 | **0.57** | **17 ms** |

### Temporal Offset Resolution
The default STFT hop size is 512 samples at $11,025\text{ Hz}$, yielding a temporal frame resolution of $\Delta t \approx 46.44\text{ ms}$. With an offset histogram bucket width of $100\text{ ms}$, an estimated offset error of $100\text{ ms}$ represents within $\approx 2$ frame intervals, confirming reliable temporal alignment down to $+6\text{ dB}$ SNR.

At $0\text{ dB}$ SNR (where noise energy equals acoustic signal energy), the track is still identified above the minimum score threshold, but low-frequency noise perturbations cause temporal dispersion in the dominant bucket.

---

## 3. Physical Microphone Over-the-Air Validation

Evaluated in a typical office room using a hardware Realtek ALC294 microphone capturing acoustic audio played through external monitor speakers. Audio was downsampled from $48,000\text{ Hz}$ to $11,025\text{ Hz}$ via the browser `AudioWorklet` polyphase filter and transmitted over WebSockets to production:

### Test Case: Catalogue Song ID 41 (`DJ Snake - Let Me Love You`)
- **Query Excerpt**: 10.0-second physical recording excerpt.
- **Hardware Sample Rate**: $48,000\text{ Hz}$ mono input $\to 11,025\text{ Hz}$ output.
- **Microphone RMS**: $-22.5\text{ dBFS}$ (Peak: 42%, Clipping: 0%, Zero samples: 0%).

| Diagnostic Parameter | Production Result | Acceptance Criterion | Evaluation |
|---|---|---|---|
| **Acoustic Match Result** | **`matched = true`** | `true` | **CONFIRMED** |
| **Identified Song** | **Song ID 41** | Expected Track | **ACCURATE** |
| **Winning Peak Votes** | **126 votes** | $\ge 4$ (Gate 1) | **PASS** |
| **Coherence Score** | **140.7** | $\ge 3.0$ (Gate 2) | **PASS** |
| **Total Winning Votes** | **775 distinct query points** | N/A | **INDEPENDENT** |
| **Raw Pairwise Matches** | **11,913 combinations** | N/A (Observability) | **BOUNDED** |
| **Coherence Ratio** | **16.26%** | $\ge 5.0\%$ (Gate 3) | **PASS** |
| **Separation Margin** | **86.0%** (Runner-up: 17.1) | $\ge 15.0\%$ (Gate 4) | **PASS** |
| **Composite Confidence** | **0.94** | $\ge 0.35$ (Gate 5) | **PASS** |
| **Estimated Track Offset** | **29,900 ms** ($\approx 29.9\text{ s}$) | $\approx 30.0\text{ s}$ Ground Truth | **EXACT ($\le 100\text{ ms}$)** |

---

## 4. False-Positive & Negative Control Testing

To verify rejection immunity against false alarms, negative controls were evaluated against the 35-track catalogue ($3.32\text{M}$ fingerprints):

| Test Input | Input Characteristics | Expected Result | Actual Result | Rejection Gate |
|---|---|---|---|---|
| **White Gaussian Noise** | Pure synthetic noise, 3.0s | `matched = false` | `matched = false` | `GATE_1_PEAK_VOTES` / `GATE_3_COHERENCE_RATIO` |
| **Unindexed Pop Song** | Clean 10s excerpt not in catalogue | `matched = false` | `matched = false` | `GATE_1_PEAK_VOTES` (Scatter $< 4$ votes) |
| **Ambient Silence / Fan Noise** | Mic noise floor $-48\text{ dBFS}$ | `matched = false` | `matched = false` | `INSUFFICIENT_FEATURES` |
| **Ambiguous Candidates** | Synthetic chord equally present in 2 songs | `matched = false` | `matched = false` | `GATE_4_AMBIGUITY` (Margin $< 15\%$) |
