// AudioWorkletProcessor running on audio rendering thread
// Captures audio, applies 20 Hz DC-blocking high-pass filter, downmixes to mono,
// resamples to 11,025 Hz using a genuinely symmetric polyphase windowed-sinc filter,
// and posts 16-bit PCM buffers to the main thread for recognition streaming.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 11025;
    this.bufferSize = 2048; // 2048 samples = 4096 bytes per frame
    this.outputBuffer = new Int16Array(this.bufferSize);
    this.outputIndex = 0;

    const currentRate = typeof sampleRate !== 'undefined' ? sampleRate : 48000;
    this.inputRate = currentRate;
    this.ratio = this.inputRate / this.targetRate;

    // Filter order: M=64 (129 taps) for 44.1k/48k; M=128 (257 taps) for 96k
    this.M = this.inputRate >= 88200 ? 128 : 64;
    this.numTaps = 2 * this.M + 1; // Always odd for exact symmetry at Phase 0
    this.P = 128;                  // 128 polyphase subdivisions
    this.phase = 0.0;
    this.history = new Float32Array(this.numTaps);

    // 20 Hz DC Blocker pole R = 1 - 2*pi*fc/fs
    this.dcR = Math.max(0.99, 1.0 - (2.0 * Math.PI * 20.0 / this.inputRate));
    this.dcXPrev = 0.0;
    this.dcYPrev = 0.0;

    // Precompute genuinely symmetric polyphase windowed-sinc table
    const effectiveCutoff = Math.min(4800, (this.targetRate / 2) * 0.92);
    const normalizedCutoff = effectiveCutoff / this.inputRate;
    this.polyTable = new Float32Array(this.P * this.numTaps);

    for (let p = 0; p < this.P; p++) {
      const frac = p / this.P;
      const offset = p * this.numTaps;
      let sum = 0.0;

      for (let idx = 0; idx < this.numTaps; idx++) {
        const k = idx - this.M;
        const t = k - frac;

        let sincVal;
        if (Math.abs(t) < 1e-9) {
          sincVal = 2.0 * normalizedCutoff;
        } else {
          sincVal = Math.sin(2.0 * Math.PI * normalizedCutoff * t) / (Math.PI * t);
        }

        const wArg = Math.abs(t) / this.M;
        let win = 0.0;
        if (wArg <= 1.0) {
          win = 0.42 + 0.5 * Math.cos(Math.PI * wArg) + 0.08 * Math.cos(2.0 * Math.PI * wArg);
        }

        const tapVal = sincVal * win;
        this.polyTable[offset + idx] = tapVal;
        sum += tapVal;
      }

      if (sum !== 0.0) {
        for (let j = 0; j < this.numTaps; j++) {
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
    if (outputs[0] && outputs[0][0]) {
      outputs[0][0].fill(0);
    }

    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const numChannels = input.length;
    const channelLength = input[0].length;
    if (channelLength === 0) return true;

    // 1. Downmix to mono and apply 20 Hz DC blocker
    const monoInput = new Float32Array(channelLength);
    const R = this.dcR;

    for (let i = 0; i < channelLength; i++) {
      let rawSample = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        rawSample += input[ch][i];
      }
      rawSample /= numChannels;

      // 20 Hz DC blocker removes hardware ADC bias
      const dcFiltered = rawSample - this.dcXPrev + R * this.dcYPrev;
      this.dcXPrev = rawSample;
      this.dcYPrev = dcFiltered;

      monoInput[i] = dcFiltered;

      const absSample = Math.abs(dcFiltered);
      if (absSample > this.intervalPeak) this.intervalPeak = absSample;
      if (absSample >= 0.999) this.intervalClipped++;
      if (absSample < 1e-5) this.intervalZeros++;
      this.intervalSumSq += dcFiltered * dcFiltered;
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

    // 3. Genuinely Symmetric Polyphase Windowed-Sinc Convolution
    const fullLen = this.numTaps + channelLength;
    const fullBuf = new Float32Array(fullLen);
    fullBuf.set(this.history, 0);
    fullBuf.set(monoInput, this.numTaps);

    while (this.phase + this.M <= fullLen - 1 - this.M) {
      const center = this.phase + this.M;
      const idx = Math.floor(center);
      const frac = center - idx;
      const pIdx = Math.min(this.P - 1, Math.max(0, Math.floor(frac * this.P)));
      const pOffset = pIdx * this.numTaps;

      let conv = 0.0;
      for (let k = 0; k < this.numTaps; k++) {
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
    this.history.set(fullBuf.subarray(fullLen - this.numTaps));

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
