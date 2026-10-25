# EchoTrace: Benchmarks & Empirical Robustness Measurements

## 1. Test Methodology
Benchmarks evaluate algorithmic accuracy, time-offset tolerance, and search latency across three criteria:
1. **Clean Audio Excerpt Matching**: 4-second random crops from indexed recordings.
2. **Noise Tolerance (SNR Sweep)**: Evaluating true match rate when white/ambient noise is added at varying Signal-to-Noise Ratios (+20 dB down to 0 dB).
3. **Execution Latency**: Time required for FFT computation, hash generation, database candidate retrieval, and histogram voting.

## 2. Target Performance Objectives
- **Search Latency Target**: $\le 150\text{ ms}$ for a 4-second excerpt against an indexed database.
- **Timestamp Offset Accuracy**: $\le \pm 100\text{ ms}$ error relative to true origin timestamp.
- **False Positive Rejection**: Unindexed / random audio inputs correctly yield `matched: false`.

## 3. Benchmark Fixtures
- Deterministic synthetic audio generated via Java (multi-tone harmonic chords, sinusoidal sweeps).
- Permissively licensed acoustic recordings (e.g. classical piano, acoustic guitar).

*(Results table populated after running automated benchmark suites).*
