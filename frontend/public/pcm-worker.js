// AudioWorkletProcessor running on audio rendering thread
// Captures audio, converts multi-channel to mono, resamples to 11,025 Hz, and ports 16-bit PCM buffers
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 11025;
    this.bufferSize = 2048; // 2048 samples = 4096 bytes per frame
    this.outputBuffer = new Int16Array(this.bufferSize);
    this.outputIndex = 0;
    this.phase = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const numChannels = input.length;
    const channelLength = input[0].length;
    if (channelLength === 0) return true;

    // Resample factor: ratio of current context sampleRate to target 11,025 Hz
    const currentRate = typeof sampleRate !== 'undefined' ? sampleRate : 44100;
    const ratio = currentRate / this.targetRate;

    if (Math.abs(currentRate - this.targetRate) < 1) {
      // Direct 1:1 mapping when AudioContext is already 11,025 Hz
      for (let i = 0; i < channelLength; i++) {
        let sample = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          sample += input[ch][i];
        }
        sample /= numChannels;

        const s = Math.max(-1, Math.min(1, sample));
        this.outputBuffer[this.outputIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

        if (this.outputIndex >= this.bufferSize) {
          const chunk = this.outputBuffer.slice(0, this.bufferSize).buffer;
          this.port.postMessage(chunk, [chunk]);
          this.outputIndex = 0;
        }
      }
    } else {
      // Linear interpolation downsampling for 44.1 kHz, 48 kHz, or other hardware sample rates
      while (this.phase < channelLength) {
        const idx0 = Math.floor(this.phase);
        const idx1 = Math.min(idx0 + 1, channelLength - 1);
        const frac = this.phase - idx0;

        let sample0 = 0;
        let sample1 = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          sample0 += input[ch][idx0];
          sample1 += input[ch][idx1];
        }
        sample0 /= numChannels;
        sample1 /= numChannels;

        const interpolated = sample0 + frac * (sample1 - sample0);
        const s = Math.max(-1, Math.min(1, interpolated));
        this.outputBuffer[this.outputIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

        if (this.outputIndex >= this.bufferSize) {
          const chunk = this.outputBuffer.slice(0, this.bufferSize).buffer;
          this.port.postMessage(chunk, [chunk]);
          this.outputIndex = 0;
        }

        this.phase += ratio;
      }
      this.phase -= channelLength;
    }

    return true;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
