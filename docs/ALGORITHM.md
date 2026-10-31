# Amber: Algorithmic & Mathematical Specification

## 1. Audio Normalization & Representation

### 1.1 Target Sampling Rate
All audio input (whether uploaded media containers or live browser microphone streams) is normalized to a canonical format:
- **Sample Rate**: $f_s = 11,025\text{ Hz}$
- **Channels**: 1 (Mono)
- **Bit Depth**: 16-bit signed integer linear PCM (Little-Endian)
- **Sample Dynamic Range**: $[-32,768, +32,767]$

At $f_s = 11,025\text{ Hz}$, the Nyquist frequency is:
$$f_{\text{Nyquist}} = \frac{f_s}{2} = 5,512.5\text{ Hz}$$
This bandwidth captures fundamental musical frequencies and harmonic overtones up to $5.5\text{ kHz}$ (covering the full standard 88-key piano range where the highest note $C_8 \approx 4,186\text{ Hz}$), while minimizing STFT buffer memory and database storage footprint.

### 1.2 Polyphase Resampling in the Browser
When capturing microphone audio at hardware rates (typically $48,000\text{ Hz}$ or $44,100\text{ Hz}$), live downsampling is executed using a **128-phase Blackman-windowed sinc polyphase FIR filter**:
- **Filter Cutoff**: $f_{\text{cutoff}} = 4,800\text{ Hz}$ for $44.1\text{ kHz}$ and $48\text{ kHz}$ inputs targeting $11,025\text{ Hz}$ (configured as $\min(4800, (f_{\text{target}}/2) \times 0.92) = 4,800\text{ Hz}$, providing steep attenuation before the $5,512.5\text{ Hz}$ Nyquist frequency).
- **Stopband Verification**: Verified via unit tests (`frontend/test/resampler.test.mjs`) confirming stopband attenuation $\ge 50\text{ dB}$ across all 128 phases at five discrete sampled frequencies ($5,750\text{ Hz}$, $6,000\text{ Hz}$, $8,000\text{ Hz}$, $12,000\text{ Hz}$, and $16,000\text{ Hz}$) for both $44.1\text{ kHz}$ and $48\text{ kHz}$ inputs.
- **DC Blocker**: First-order high-pass IIR filter ($f_c \approx 20\text{ Hz}$) eliminating hardware ADC DC offset:
  $$y[n] = x[n] - x[n-1] + R \cdot y[n-1], \quad R = 1 - \frac{2\pi \cdot 20}{f_s}$$

---

## 2. Short-Time Fourier Transform (STFT) & FFT

### 2.1 STFT Windowing and Framing
The continuous audio signal is framed into overlapping blocks:
- **Frame Size**: $N = 1,024$ samples ($\approx 92.88\text{ ms}$)
- **Hop Size**: $H = 512$ samples (50% overlap, $\approx 46.44\text{ ms}$ per frame)
- **Spectral Resolution**:
  $$\Delta f = \frac{f_s}{N} = \frac{11,025}{1,024} \approx 10.7666\text{ Hz/bin}$$
- **Window Function**: Periodic Hann window to suppress spectral leakage:
  $$w[n] = 0.5 \cdot \left(1 - \cos\left(\frac{2\pi n}{N}\right)\right), \quad n = 0, 1, \dots, N-1$$

### 2.2 Radix-2 Cooley–Tukey FFT
Amber implements an in-place decimation-in-time (DIT) Fast Fourier Transform:
$$X[k] = \sum_{n=0}^{N-1} x[n] \cdot w[n] \cdot e^{-j \frac{2\pi k n}{N}}, \quad k = 0, \dots, N-1$$

**Implementation Details**:
1. **Bit-Reversal Permutation**: Precomputed bit-reversal lookup table reorders input samples in $\mathcal{O}(N)$ time.
2. **Butterfly Stages**: $\log_2(1,024) = 10$ butterfly stages compute intermediate combinations in place.
3. **Precomputed Twiddle Factors**: Sine and cosine tables are computed once at JVM startup, eliminating trigonometric runtime calls:
   $$W_N^k = \cos\left(-\frac{2\pi k}{N}\right) + j \sin\left(-\frac{2\pi k}{N}\right)$$
4. **Power Spectrum Calculation**: For the $N/2 = 512$ non-redundant positive frequency bins:
   $$P[k] = \text{Re}(X[k])^2 + \text{Im}(X[k])^2, \quad k = 0, 1, \dots, 511$$

---

## 3. Logarithmic Spectral Peak Extraction

To emulate human auditory perception, the 512 positive frequency bins are partitioned into **10 logarithmic frequency sub-bands**:

| Band Index | Frequency Range (Hz) | Bin Range ($k$) | Band Width (Bins) |
|---|---|---|---|
| **0** | $0.0 - 107.7\text{ Hz}$ | $0 - 9$ | 10 |
| **1** | $107.7 - 215.3\text{ Hz}$ | $10 - 19$ | 10 |
| **2** | $215.3 - 430.7\text{ Hz}$ | $20 - 39$ | 20 |
| **3** | $430.7 - 646.0\text{ Hz}$ | $40 - 59$ | 20 |
| **4** | $646.0 - 969.0\text{ Hz}$ | $60 - 89$ | 30 |
| **5** | $969.0 - 1,399.7\text{ Hz}$ | $90 - 129$ | 40 |
| **6** | $1,399.7 - 1,938.0\text{ Hz}$ | $130 - 179$ | 50 |
| **7** | $1,938.0 - 2,691.7\text{ Hz}$ | $180 - 249$ | 70 |
| **8** | $2,691.7 - 3,768.3\text{ Hz}$ | $250 - 349$ | 100 |
| **9** | $3,768.3 - 5,512.5\text{ Hz}$ | $350 - 511$ | 162 |

### Peak Selection Criteria
A spectral point at bin $k$ and frame $t$ is designated as a constellation peak if:
1. **Local Spectral Dominance**: $P[k, t] > P[k \pm 1, t]$ and $P[k, t] > P[k \pm 2, t]$.
2. **Local Temporal Dominance**: $P[k, t] > P[k, t \pm 1]$ and $P[k, t] > P[k, t \pm 2]$.
3. **Adaptive Energy Threshold**:
   $$P[k, t] > 2.0 \cdot \mu_{\text{band}}(t)$$
   where $\mu_{\text{band}}(t)$ is the mean energy of that sub-band in frame $t$.
4. **Density Limiting**: At most 3 prominent peaks are retained per band per frame, preventing noise explosion in percussive bursts.

---

## 4. Combinatorial Constellation Hashing

Acoustic fingerprints are created by pairing anchor peaks with target peaks in a forward time window:

```
Frequency (Hz)
    ^
    |          Target Zone (dt in [1, 63] frames)
    |          +--------------------------------------+
f2  | - - - - -|- - - - - - - - - - - - - -*(Target)  |
    |          |                                      |
f1  | *(Anchor)|                                      |
    |          +--------------------------------------+
    +--------->|-------------------------------------> Time (Frames)
              t1                                     t2
              <------------ delta_t -------------->
```

### 4.1 Target Pairing Window
For each anchor peak $P_1 = (f_1, t_1)$:
- Forward target interval: $\Delta t = (t_2 - t_1) \in [1, 63]$ frames ($\approx 46.4\text{ ms}$ to $2,925.7\text{ ms}$).
- Anchor is paired with up to $K = 5$ closest target peaks $P_2 = (f_2, t_2)$ within this forward zone.

### 4.2 Compact 32-Bit Bitwise Hash Packing
Each anchor-target pair is encoded into a signed 32-bit integer representation:
- **Anchor Frequency ($f_1$)**: 9 bits ($0 \dots 511$)
- **Target Frequency ($f_2$)**: 9 bits ($0 \dots 511$)
- **Time Difference ($\Delta t$)**: 6 bits ($1 \dots 63$)

$$\text{Hash} = (f_1 \ll 15) \mid (f_2 \ll 6) \mid (\Delta t \& 0\text{x}3F)$$

This layout produces a 24-bit compact value stored as a standard PostgreSQL `INTEGER`.

---

## 5. Independent Query-Support Offset Histogram Matching

### 5.1 Time Delta Formulation
For an indexed database fingerprint $(h, \text{song\_id}, t_{db})$ and a query fingerprint $(h, t_q)$ sharing the same hash $h$:
$$\Delta t_{\text{offset}} = t_{db} - t_q$$

Offsets are accumulated into discrete histogram buckets of width $W = 100\text{ ms}$:
$$\text{bucketKey} = \left\lfloor \frac{\Delta t_{\text{offset}}}{W} \right\rfloor \cdot W$$

### 5.2 Independent Query Support vs. Cartesian Multiplication
In dense recordings with repeated musical motifs (e.g. repeated drum hits or harmonic riffs), a single hash $h$ may appear $N_q$ times in the query and $N_{db}$ times in the database song.

**The Cartesian Product Flaw**:
In naive accumulators, looping over both query occurrences and database occurrences adds $N_q \times N_{db}$ votes. For dense songs, this multiplied candidate totals to thousands of votes, driving coherence ratio $\frac{\text{Peak}}{\text{Total}}$ below 1%, causing false rejections of genuine matches.

**The Independent Query Support Solution**:
Amber identifies each query feature occurrence by its unique coordinates:
$$\text{QueryPoint} = (\text{hash}, t_q)$$

- **Bucket Level**: Each `QueryPoint` can support a specific offset bucket **at most once**:
  $$\text{bucketVotes}(B) = |\text{Unique QueryPoints supporting bucket } B|$$
- **Candidate Level**: Each `QueryPoint` contributes **at most once** to the candidate's total distinct support:
  $$\text{uniqueQuerySupport}(S) = |\text{Unique QueryPoints that matched candidate } S|$$
- **Raw Pairwise Matches**: Total combinations $N_q \times N_{db}$ are tracked separately for diagnostic observability without affecting scoring.

---

## 6. Scoring, Coherence Ratio & Confidence

### 6.1 Coherence Score
The signal-to-noise score penalizes peak votes by background scatter noise:
$$\text{Score} = \max\left(0, \text{PeakVotes} - \text{MedianNoiseVotes}\right) \cdot \left(1.0 + \text{CoherenceRatio}\right)$$
where $\text{MedianNoiseVotes}$ is the median independent vote count across non-peak offset buckets.

### 6.2 Coherence Ratio
The concentration of matching features in the dominant offset bucket:
$$\text{CoherenceRatio} = \frac{\text{PeakVotes}}{\text{uniqueQuerySupport}(S)}$$
Because both numerator and denominator count independent query points:
$$0.0 \le \text{CoherenceRatio} \le 1.0$$

### 6.3 Separation Margin
Relative separation between the winning candidate ($S_1$) and the runner-up ($S_2$):
$$\text{Margin} = \frac{\text{Score}(S_1) - \text{Score}(S_2)}{\max(\text{Score}(S_1), 1.0)}$$
For a solitary candidate, margin is conservatively estimated between $0.50$ and $0.88$ based on signal prominence.

### 6.4 Composite Confidence
A continuous metric combining peak strength and candidate separation:
$$\text{Confidence} = 0.50 \cdot \min\left(1.0, \frac{\text{PeakVotes}}{30}\right) + 0.50 \cdot \min\left(1.0, \text{Margin}\right)$$

---

## 7. Multi-Factor False-Positive Acceptance Gates & Catalogue Verification

To guarantee that random background noise or unindexed music is never misidentified, candidate matches must satisfy **5 sequential acoustic acceptance gates**, followed by a post-acceptance database integrity verification:

```
Candidate Match Evaluation
         │
         ▼
[Gate 1: Peak Votes >= 4] ───────────────────────► REJECT (GATE_1_PEAK_VOTES): Insufficient time-coherent votes
         │ (PASS)
         ▼
[Gate 2: Score >= 3.0] ──────────────────────────► REJECT (GATE_2_SCORE): Coherence score below threshold
         │ (PASS)
         ▼
[Gate 3: Coherence Ratio >= 0.05] ───────────────► REJECT (GATE_3_COHERENCE_RATIO): Offset scatter indicates random collisions
         │ (PASS)
         ▼
[Gate 4: Ambiguity Margin >= 0.15] ──────────────► REJECT (GATE_4_AMBIGUITY): Ambiguous candidates exhibit comparable correlation
         │ (PASS)
         ▼
[Gate 5: Confidence >= 0.35] ────────────────────► REJECT (GATE_5_CONFIDENCE): Composite confidence below acceptance threshold
         │ (PASS)
         ▼
[Integrity Check: Catalogue Record Exists] ──────► REJECT (GATE_6_CATALOGUE_NOT_FOUND): Catalogue metadata not found
         │ (PASS)
         ▼
    MATCH CONFIRMED (HTTP 200 / MATCH_UPDATE matched=true)
```

| Gate / Check Name | Parameter / Metric | Threshold | Gate Classification | Purpose |
|---|---|---|---|---|
| **Gate 1** | `winningPeakVotes` | $\ge 4$ | Acoustic Acceptance Gate | Minimum aligned acoustic feature pairs in a single $100\text{ ms}$ bucket. |
| **Gate 2** | `winningScore` | $\ge 3.0$ | Acoustic Acceptance Gate | Time-coherent score penalized by median background noise scatter. |
| **Gate 3** | `coherenceRatio` | $\ge 0.05$ (5.0%) | Acoustic Acceptance Gate | Rejects random background hash collisions dispersed across time. |
| **Gate 4** | `margin` | $\ge 0.15$ (15.0%) | Acoustic Acceptance Gate | Rejects ambiguous ties when runner-up score $\ge 2.0$ and margin $< 0.15$. |
| **Gate 5** | `confidence` | $\ge 0.35$ (35.0%) | Acoustic Acceptance Gate | Composite threshold combining peak prominence and candidate margin. |
| **Integrity Check** (`GATE_6_CATALOGUE_NOT_FOUND`) | `songRepository.findById` | Exists in DB | Database Integrity Check | Post-acceptance integrity verification confirming winning metadata remains active in PostgreSQL. |
