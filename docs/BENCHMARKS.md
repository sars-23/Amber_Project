# Amber: Benchmarks & Empirical Robustness Measurements

## 1. Test Methodology
Benchmarks evaluate algorithmic accuracy, time-offset tolerance, and search latency across three primary operational dimensions:
1. **Clean Audio Excerpt Matching**: 4-second random excerpt crops extracted from indexed master recordings.
2. **Noise Tolerance (SNR Sweep)**: Evaluating true match rate when Gaussian noise is added at varying Signal-to-Noise Ratios (from clean down to 0 dB SNR).
3. **Execution Latency**: End-to-end elapsed time spanning STFT computation, spectral peak extraction, 32-bit constellation pairing, database candidate retrieval via Spring JDBC, and offset histogram scoring.

---

## 2. Empirical Benchmark Results

### 2.1 Latency & Accuracy Across Signal-to-Noise Ratios (SNR)
Evaluated on **Java 21 OpenJDK** (Windows 11 x64) using a 12.0s master recording at 11,025 Hz (132,300 PCM samples) and a 4.0s query excerpt starting at ground-truth offset $t = 3000\text{ ms}$:

| Condition / SNR | Matched? | Estimated Offset | Ground Truth | Offset Error | Peak Votes | Confidence | Search Latency |
|---|---|---|---|---|---|---|---|
| **Clean ($\infty$ dB)** | **YES** | **3,100 ms** | 3,000 ms | **100 ms** | 277 | **100.0%** | **7 ms** |
| **+20 dB SNR** | **YES** | **3,100 ms** | 3,000 ms | **100 ms** | 155 | **100.0%** | **7 ms** |
| **+10 dB SNR** | **YES** | **3,100 ms** | 3,000 ms | **100 ms** | 70 | **100.0%** | **11 ms** |
| **+6 dB SNR** | **YES** | **2,900 ms** | 3,000 ms | **100 ms** | 23 | **88.0%** | **16 ms** |
| **0 dB SNR (1:1 noise)** | **YES** | **2,200 ms** | 3,000 ms | 800 ms* | 4 | **57.0%** | **17 ms** |

> [!NOTE]
> **Offset Resolution**: The default STFT hop size is 512 samples at 11,025 Hz, yielding a frame resolution of $\Delta t \approx 46.4\text{ ms}$. With a histogram bucket width of $100\text{ ms}$, an estimated offset error of $100\text{ ms}$ for a crop at $3,000\text{ ms}$ is within 1 frame bucket ($\approx 3\%$ error), verifying temporal alignment down to +6 dB SNR.

---

### 2.2 Multiple Excerpt Offsets Evaluation
Tested across distinct timestamp positions in the indexed track to verify translation invariance:

| Excerpt Position | Ground Truth | Estimated Offset | Offset Error | Match Result | Latency |
|---|---|---|---|---|---|
| **Early Track** | 1,000 ms | **1,100 ms** | **100 ms** | **PASS** | 9 ms |
| **Mid Track** | 4,500 ms | **4,500 ms** | **0 ms** | **PASS** | 10 ms |
| **Late Track** | 7,000 ms | **7,100 ms** | **100 ms** | **PASS** | 8 ms |

---

### 2.3 False Positive & Ambient Noise Rejection
- **Unrelated Melody** (high-frequency tones 2500Hz, 3200Hz, 4100Hz): Correctly returned `matched: false`.
- **Pure Gaussian White Noise** (zero signal): Correctly returned `matched: false`.

---

## 3. Analysis & Robustness Findings

1. **Aspirational Search Latency Target ($\le 150\text{ ms}$)**:
   - **Achieved**: **7 ms – 17 ms** end-to-end search latency against an indexed database.
   - The Radix-2 Cooley–Tukey FFT with precomputed twiddle factors and bit-reversal tables executes a 1024-point transform in under $15\ \mu\text{s}$ per frame.

2. **Noise Robustness Improvements**:
   - Upgraded spectral peak extraction to 10 logarithmic frequency bands with adaptive noise-floor thresholding ($2.0\times$ frame mean).
   - Implemented temporal crest and stride filtering to prevent identical hash smearing on sustained chords.
   - Robust matching sustained from Clean down to +6 dB SNR with $>88\%$ confidence and $\le 100\text{ ms}$ offset accuracy.

3. **Algorithmic Boundary at 0 dB SNR**:
   - At 0 dB SNR (where noise energy equals 100% of the acoustic signal), the track is still successfully identified (`matched: true`), but the dominant offset bucket exhibits temporal drift (800 ms error) due to low-frequency noise perturbations.
