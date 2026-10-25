# Amber: Algorithmic Specification

## 1. Mathematical Foundations

### 1.1 Sampling and Resampling
- Audio is normalized to **11,025 Hz** mono signed 16-bit PCM.
- Nyquist frequency $f_{Nyquist} = 5,512.5\text{ Hz}$, which adequately captures the fundamental and rich harmonic spectral content for acoustic identification while maintaining a compact memory footprint.

### 1.2 Radix-2 Cooley–Tukey Fast Fourier Transform
Given an input vector $x[n]$ of length $N = 1024$:
$$X[k] = \sum_{n=0}^{N-1} x[n] \cdot e^{-j 2\pi k n / N}, \quad k = 0, \dots, N-1$$

We implement decimation-in-time (DIT) bit-reversal sorting followed by $\log_2(N) = 10$ butterfly stages. Reusable arrays for real and imaginary components prevent garbage collection pauses during high-throughput search or streaming.

Frequency resolution per bin:
$$\Delta f = \frac{f_s}{N} = \frac{11025}{1024} \approx 10.7666\text{ Hz/bin}$$
Bin $k=41$ corresponds to $\approx 441.4\text{ Hz}$, closely matching standard concert pitch $A_4$ (440 Hz).

### 1.3 Hann Windowing
To eliminate spectral leakage at frame discontinuities:
$$w[n] = 0.5 \cdot \left(1 - \cos\left(\frac{2\pi n}{N - 1}\right)\right)$$
Window hop size is $H = 512$ samples (50% overlap), yielding a temporal resolution:
$$\Delta t_{hop} = \frac{512}{11025} \approx 46.44\text{ ms/frame}$$

---

## 2. Spectral Peak Extraction & Constellation Map

1. **Logarithmic Frequency Bins**: Human auditory perception and musical notes scale logarithmically. The 512 positive frequency bins are segmented into bands (e.g. 0-10, 10-20, 20-40, 40-80, 80-160, 160-511).
2. **Local Peak Selection**: A spectral bin $(k, t)$ is a peak if:
   - Its magnitude $|X[k, t]|$ is strictly greater than neighboring bins in both frequency ($\pm 2$ bins) and time ($\pm 2$ frames).
   - Its magnitude exceeds an adaptive local threshold derived from the mean energy of that frequency band.
3. **Density Throttling**: Limit maximum peaks per frame (e.g. top 3-5 peaks per band) to prevent explosion of combinatorial hashes in noisy segments.

---

## 3. Combinatorial Hash Generation

For each anchor peak $P_1 = (f_1, t_1)$:
1. Define a target forward window:
   $$t_2 \in [t_1 + \delta_{min}, t_1 + \delta_{max}]$$
   where $\delta_{min} = 1$ frame ($\approx 46.4\text{ ms}$) and $\delta_{max} = 64$ frames ($\approx 2.97\text{ s}$).
2. For up to $K$ target peaks $P_2 = (f_2, t_2)$ within the zone:
   - Anchor Frequency: $f_1 \in [0, 511]$ (9 bits)
   - Target Frequency: $f_2 \in [0, 511]$ (9 bits)
   - Time Delta: $\Delta t = (t_2 - t_1) \in [1, 63]$ (6 bits)
3. **Bitwise Encoding**:
   $$\text{Hash} = (f_1 \ll 15) \mid (f_2 \ll 6) \mid (\Delta t \& 0\text{x}3F)$$
   This generates a dense 24-bit integer packed within a signed 32-bit Java `int`.

---

## 4. Time-Coherent Offset Histogram Matching

For query fingerprints $Q = \{(h_i, t_{q, i})\}$ and database fingerprints $D = \{(h_i, \text{song\_id}, t_{db, i})\}$ sharing the same hash $h_i$:
$$\text{Offset} = t_{db, i} - t_{q, i}$$

- A histogram of time offsets is accumulated per candidate song ID in buckets (bucket width $\approx 100\text{ ms}$).
- Unrelated tracks exhibit uniformly distributed random collision offsets (low noise floor).
- A true match produces a sharp, coherent peak at the true track offset:
  $$\text{Score} = \text{Peak Votes} - \text{Median Noise Floor}$$
- Confidence is computed as the ratio of peak votes over total matching query hashes and candidate separation.
