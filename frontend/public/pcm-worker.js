// AudioWorkletProcessor running on audio rendering thread
// Captures single-channel audio, downsamples/accumulates to 11,025 Hz, and ports PCM buffers
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048;
    this.buffer = new Int16Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0];
    for (let i = 0; i < channelData.length; i++) {
      // Float32 [-1.0, 1.0] -> Int16 [-32768, 32767]
      const s = Math.max(-1, Math.min(1, channelData[i]));
      this.buffer[this.bufferIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

      if (this.bufferIndex >= this.bufferSize) {
        this.port.postMessage(this.buffer.slice(0, this.bufferSize).buffer, [this.buffer.slice(0, this.bufferSize).buffer]);
        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
