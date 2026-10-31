/**
 * High-quality polyphase windowed-sinc audio resampler for real-time Web Audio processing.
 *
 * Designed to downsample native browser AudioContext streams (44.1 kHz, 48 kHz, 96 kHz)
 * to 11,025 Hz mono signed 16-bit little-endian PCM with steep anti-aliasing low-pass
 * filtering (Blackman-windowed sinc), preserving the spectral integrity of acoustic
 * constellation peaks without fold-over aliasing.
 */

export interface ResamplerMetrics {
  totalSamples: number;
  clippedSamples: number;
  clippingPercentage: number;
  zeroSamples: number;
  zeroPercentage: number;
  peakAmplitude: number;
  rms: number;
  rmsDbfs: number;
}

export class PolyphaseResampler {
  readonly inputSampleRate: number;
  readonly targetSampleRate: number;
  readonly ratio: number;
  readonly filterHalfLength: number; // M taps
  readonly phases: number;           // P subdivisions
  readonly polyTable: Float32Array;  // P * (2 * M)
  
  private history: Float32Array;     // 2 * M
  private phase: number;             // Fractional phase
  private outputBuffer: Int16Array;
  private outputIndex: number;
  private readonly bufferSize: number;

  // Signal observability counters
  private totalInputSamples: number = 0;
  private clippedInputSamples: number = 0;
  private zeroInputSamples: number = 0;
  private peakInputAmplitude: number = 0;
  private sumSquares: number = 0;

  constructor(
    inputSampleRate: number = 48000,
    targetSampleRate: number = 11025,
    bufferSize: number = 2048,
    filterHalfLength: number = 16,
    phases: number = 128,
    cutoffFreq: number = 5000
  ) {
    this.inputSampleRate = Math.max(1000, inputSampleRate);
    this.targetSampleRate = Math.max(1000, targetSampleRate);
    this.bufferSize = bufferSize;
    this.filterHalfLength = filterHalfLength;
    this.phases = phases;
    this.ratio = this.inputSampleRate / this.targetSampleRate;

    const M = this.filterHalfLength;
    const P = this.phases;
    const twoM = 2 * M;
    this.polyTable = new Float32Array(P * twoM);
    this.history = new Float32Array(twoM);
    this.phase = 0.0;
    this.outputBuffer = new Int16Array(this.bufferSize);
    this.outputIndex = 0;

    // Calculate normalized cutoff relative to input sample rate
    // Target Nyquist is targetSampleRate / 2 (5,512.5 Hz). Cutoff at ~5,000 Hz provides
    // steep attenuation before 5,512.5 Hz while preserving bands up to 5,000 Hz.
    const effectiveCutoff = Math.min(cutoffFreq, (this.targetSampleRate / 2) * 0.95);
    const normalizedCutoff = effectiveCutoff / this.inputSampleRate;

    // Precompute polyphase windowed-sinc table with Blackman window
    for (let p = 0; p < P; p++) {
      const frac = p / P;
      const offset = p * twoM;
      let sum = 0.0;

      for (let k = -M; k < M; k++) {
        const t = k - frac;
        let sinc = 1.0;
        if (Math.abs(t) > 1e-9) {
          sinc = Math.sin(2.0 * Math.PI * normalizedCutoff * t) / (Math.PI * t);
        }

        // Exact Blackman window across [-M, M]
        const wArg = (t + M) / twoM;
        let win = 0.0;
        if (wArg >= 0.0 && wArg <= 1.0) {
          win = 0.42 - 0.5 * Math.cos(2.0 * Math.PI * wArg) + 0.08 * Math.cos(4.0 * Math.PI * wArg);
        }

        const tapVal = sinc * win;
        this.polyTable[offset + (k + M)] = tapVal;
        sum += tapVal;
      }

      // Normalize filter taps to sum = 1.0 for exact unity passband gain
      if (sum !== 0.0) {
        for (let j = 0; j < twoM; j++) {
          this.polyTable[offset + j] /= sum;
        }
      }
    }
  }

  /**
   * Downmixes multichannel float32 audio input to mono and updates signal metrics.
   */
  downmixToMono(inputChannels: Float32Array[] | Float32Array, outputMono: Float32Array): number {
    const isArrayOfChannels = Array.isArray(inputChannels);
    const numChannels = isArrayOfChannels ? inputChannels.length : 1;
    const channelLength = isArrayOfChannels ? inputChannels[0].length : inputChannels.length;

    let localPeak = 0;
    let localClipped = 0;
    let localZeros = 0;
    let localSumSq = 0;

    for (let i = 0; i < channelLength; i++) {
      let monoSample = 0;
      if (numChannels === 1) {
        monoSample = isArrayOfChannels ? inputChannels[0][i] : inputChannels[i];
      } else {
        for (let c = 0; c < numChannels; c++) {
          monoSample += (inputChannels as Float32Array[])[c][i];
        }
        monoSample /= numChannels;
      }

      outputMono[i] = monoSample;

      const absSample = Math.abs(monoSample);
      if (absSample > localPeak) localPeak = absSample;
      if (absSample >= 0.999) localClipped++;
      if (absSample < 1e-5) localZeros++;
      localSumSq += monoSample * monoSample;
    }

    this.totalInputSamples += channelLength;
    this.clippedInputSamples += localClipped;
    this.zeroInputSamples += localZeros;
    this.sumSquares += localSumSq;
    if (localPeak > this.peakInputAmplitude) {
      this.peakInputAmplitude = localPeak;
    }

    return channelLength;
  }

  /**
   * Processes a block of input audio frames (e.g. 128 frames from AudioWorklet).
   * Emits chunks of signed 16-bit PCM (bufferSize samples each) via callback.
   */
  process(
    inputChannels: Float32Array[] | Float32Array,
    onChunk: (chunk: ArrayBuffer) => void
  ): void {
    if (!inputChannels || inputChannels.length === 0) return;
    const channelLength = Array.isArray(inputChannels)
      ? inputChannels[0]?.length ?? 0
      : inputChannels.length;
    if (channelLength === 0) return;

    const M = this.filterHalfLength;
    const twoM = 2 * M;
    const P = this.phases;

    // Working mono buffer
    const monoInput = new Float32Array(channelLength);
    this.downmixToMono(inputChannels, monoInput);

    // If sample rate matches target exactly, pass through directly
    if (Math.abs(this.inputSampleRate - this.targetSampleRate) < 1.0) {
      for (let i = 0; i < channelLength; i++) {
        const s = Math.max(-1.0, Math.min(1.0, monoInput[i]));
        this.outputBuffer[this.outputIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

        if (this.outputIndex >= this.bufferSize) {
          const chunk = this.outputBuffer.slice(0, this.bufferSize).buffer;
          onChunk(chunk);
          this.outputIndex = 0;
        }
      }
      return;
    }

    // Build contiguous buffer: history (2M samples) + current block (channelLength samples)
    const fullLen = twoM + channelLength;
    const fullBuf = new Float32Array(fullLen);
    fullBuf.set(this.history, 0);
    fullBuf.set(monoInput, twoM);

    // Polyphase convolution
    while (this.phase + M <= fullLen - M) {
      const center = this.phase + M;
      const idx = Math.floor(center);
      const frac = center - idx;
      const pIdx = Math.min(P - 1, Math.max(0, Math.floor(frac * P)));
      const pOffset = pIdx * twoM;

      let conv = 0.0;
      for (let k = 0; k < twoM; k++) {
        conv += fullBuf[idx - M + k] * this.polyTable[pOffset + k];
      }

      // Clamp and quantize to signed 16-bit PCM
      const s = Math.max(-1.0, Math.min(1.0, conv));
      this.outputBuffer[this.outputIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

      if (this.outputIndex >= this.bufferSize) {
        const chunk = this.outputBuffer.slice(0, this.bufferSize).buffer;
        onChunk(chunk);
        this.outputIndex = 0;
      }

      this.phase += this.ratio;
    }

    // Carry forward remaining phase and update history buffer seamlessly
    this.phase -= channelLength;
    this.history.set(fullBuf.subarray(fullLen - twoM));
  }

  /**
   * Retrieves signal metrics and resets interval counters.
   */
  getMetricsAndReset(): ResamplerMetrics {
    const total = Math.max(1, this.totalInputSamples);
    const rms = Math.sqrt(this.sumSquares / total);
    const rmsDbfs = rms <= 1e-5 ? -100 : Math.max(-100, Math.round(20 * Math.log10(rms)));

    const metrics: ResamplerMetrics = {
      totalSamples: this.totalInputSamples,
      clippedSamples: this.clippedInputSamples,
      clippingPercentage: (this.clippedInputSamples / total) * 100.0,
      zeroSamples: this.zeroInputSamples,
      zeroPercentage: (this.zeroInputSamples / total) * 100.0,
      peakAmplitude: this.peakInputAmplitude,
      rms: rms,
      rmsDbfs: rmsDbfs,
    };

    // Reset periodic counters
    this.totalInputSamples = 0;
    this.clippedInputSamples = 0;
    this.zeroInputSamples = 0;
    this.peakInputAmplitude = 0;
    this.sumSquares = 0;

    return metrics;
  }
}

/**
 * Calculates signal level and clipping metrics from signed 16-bit PCM buffer.
 */
export function calculatePcmMetrics(pcm16Buffer: ArrayBuffer): ResamplerMetrics {
  const pcm = new Int16Array(pcm16Buffer);
  if (pcm.length === 0) {
    return {
      totalSamples: 0,
      clippedSamples: 0,
      clippingPercentage: 0,
      zeroSamples: 0,
      zeroPercentage: 0,
      peakAmplitude: 0,
      rms: 0,
      rmsDbfs: -100,
    };
  }

  let clipped = 0;
  let zeros = 0;
  let peak = 0;
  let sumSq = 0;

  for (let i = 0; i < pcm.length; i++) {
    const val = pcm[i];
    const absVal = Math.abs(val);
    const norm = val / 32768.0;

    if (absVal > peak) peak = absVal;
    if (absVal >= 32760) clipped++;
    if (absVal === 0) zeros++;
    sumSq += norm * norm;
  }

  const total = pcm.length;
  const rms = Math.sqrt(sumSq / total);
  const rmsDbfs = rms <= 1e-5 ? -100 : Math.max(-100, Math.round(20 * Math.log10(rms)));

  return {
    totalSamples: total,
    clippedSamples: clipped,
    clippingPercentage: (clipped / total) * 100.0,
    zeroSamples: zeros,
    zeroPercentage: (zeros / total) * 100.0,
    peakAmplitude: peak / 32768.0,
    rms: rms,
    rmsDbfs: rmsDbfs,
  };
}
