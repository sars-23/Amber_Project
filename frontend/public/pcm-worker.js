// AudioWorkletProcessor running on audio rendering thread
// Captures audio, downmixes to mono, resamples to 11,025 Hz using a
// steep anti-aliasing polyphase windowed-sinc filter, and posts 16-bit PCM buffers
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 11025;
    this.bufferSize = 2048; // 2048 samples = 4096 bytes per frame
    this.outputBuffer = new Int16Array(this.bufferSize);
    this.outputIndex = 0;

    // Filter configuration
    this.M = 16;       // 16 zero-crossings per side = 32 taps per phase
    this.twoM = 32;
    this.P = 128;      // 128 polyphase phase subdivisions
    this.phase = 0.0;
    this.history = new Float32Array(this.twoM);

    // Resampling ratio
    const currentRate = typeof sampleRate !== 'undefined' ? sampleRate : 48000;
    this.inputRate = currentRate;
    this.ratio = this.inputRate / this.targetRate;

    // Precompute polyphase windowed-sinc table with Blackman window
    const effectiveCutoff = Math.min(5000, (this.targetRate / 2) * 0.95);
    const normalizedCutoff = effectiveCutoff / this.inputRate;
    this.polyTable = new Float32Array(this.P * this.twoM);

    for (let p = 0; p < this.P; p++) {
      const frac = p / this.P;
      const offset = p * this.twoM;
      let sum = 0.0;

      for (let k = -this.M; k < this.M; k++) {
        const t = k - frac;
        let sinc = 1.0;
        if (Math.abs(t) > 1e-9) {
          sinc = Math.sin(2.0 * Math.PI * normalizedCutoff * t) / (Math.PI * t);
        }

        const wArg = (t + this.M) / this.twoM;
        let win = 0.0;
        if (wArg >= 0.0 && wArg <= 1.0) {
          win = 0.42 - 0.5 * Math.cos(2.0 * Math.PI * wArg) + 0.08 * Math.cos(4.0 * Math.PI * wArg);
        }

        const tapVal = sinc * win;
        this.polyTable[offset + (k + this.M)] = tapVal;
        sum += tapVal;
      }

      if (sum !== 0.0) {
        for (let j = 0; j < this.twoM; j++) {
          this.polyTable[offset + j] /= sum;
        }
      }
    }

    // Telemetry tracking
    this.intervalTotal = 0;
    this.intervalClipped = 0;
    this.intervalZeros = 0;
    this.intervalPeak = 0;
    this.intervalSumSq = 0;
  }

  process(inputs, outputs, parameters) {
    // Keep audio rendering graph alive in Chromium
    if (outputs[0] && outputs[0][0]) {
      outputs[0][0].fill(0);
    }

    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const numChannels = input.length;
    const channelLength = input[0].length;
    if (channelLength === 0) return true;

    // 1. Downmix to mono and track clipping metrics
    const monoInput = new Float32Array(channelLength);
    for (let i = 0; i < channelLength; i++) {
      let monoSample = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        monoSample += input[ch][i];
      }
      monoSample /= numChannels;
      monoInput[i] = monoSample;

      const absSample = Math.abs(monoSample);
      if (absSample > this.intervalPeak) this.intervalPeak = absSample;
      if (absSample >= 0.999) this.intervalClipped++;
      if (absSample < 1e-5) this.intervalZeros++;
      this.intervalSumSq += monoSample * monoSample;
    }
    this.intervalTotal += channelLength;

    // 2. Exact sample-rate match pass-through
    if (Math.abs(this.inputRate - this.targetRate) < 1.0) {
      for (let i = 0; i < channelLength; i++) {
        const s = Math.max(-1.0, Math.min(1.0, monoInput[i]));
        this.outputBuffer[this.outputIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

        if (this.outputIndex >= this.bufferSize) {
          this.emitChunk();
        }
      }
      return true;
    }

    // 3. Polyphase Windowed-Sinc Convolution
    const fullLen = this.twoM + channelLength;
    const fullBuf = new Float32Array(fullLen);
    fullBuf.set(this.history, 0);
    fullBuf.set(monoInput, this.twoM);

    while (this.phase + this.M <= fullLen - this.M) {
      const center = this.phase + this.M;
      const idx = Math.floor(center);
      const frac = center - idx;
      const pIdx = Math.min(this.P - 1, Math.max(0, Math.floor(frac * this.P)));
      const pOffset = pIdx * this.twoM;

      let conv = 0.0;
      for (let k = 0; k < this.twoM; k++) {
        conv += fullBuf[idx - this.M + k] * this.polyTable[pOffset + k];
      }

      const s = Math.max(-1.0, Math.min(1.0, conv));
      this.outputBuffer[this.outputIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

      if (this.outputIndex >= this.bufferSize) {
        this.emitChunk();
      }

      this.phase += this.ratio;
    }

    this.phase -= channelLength;
    this.history.set(fullBuf.subarray(fullLen - this.twoM));

    return true;
  }

  emitChunk() {
    const chunk = this.outputBuffer.slice(0, this.bufferSize).buffer;
    const total = Math.max(1, this.intervalTotal);
    const rms = Math.sqrt(this.intervalSumSq / total);
    const rmsDbfs = rms <= 1e-5 ? -100 : Math.max(-100, Math.round(20 * Math.log10(rms)));

    const metrics = {
      totalSamples: this.intervalTotal,
      clippedSamples: this.intervalClipped,
      clippingPercentage: (this.intervalClipped / total) * 100.0,
      zeroPercentage: (this.intervalZeros / total) * 100.0,
      peakAmplitude: this.intervalPeak,
      rms: rms,
      rmsDbfs: rmsDbfs,
    };

    this.port.postMessage({
      type: 'PCM_CHUNK',
      buffer: chunk,
      metrics: metrics,
    }, [chunk]);

    this.outputIndex = 0;
    this.intervalTotal = 0;
    this.intervalClipped = 0;
    this.intervalZeros = 0;
    this.intervalPeak = 0;
    this.intervalSumSq = 0;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
