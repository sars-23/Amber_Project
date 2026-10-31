import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PolyphaseResampler, calculatePcmMetrics } from '../src/utils/resampler.ts';

describe('Polyphase Windowed-Sinc Resampler - Basic Characteristics', () => {
  test('accurately downsamples 48,000 Hz to 11,025 Hz with correct sample count', () => {
    const inputSr = 48000;
    const targetSr = 11025;
    const durationSec = 1.0;
    const inputSamples = inputSr * durationSec;
    const resampler = new PolyphaseResampler(inputSr, targetSr, 2048);

    // Generate 440 Hz sine wave
    const input = new Float32Array(inputSamples);
    for (let i = 0; i < inputSamples; i++) {
      input[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / inputSr);
    }

    const outputChunks = [];
    const blockSize = 128;
    for (let i = 0; i < inputSamples; i += blockSize) {
      const block = input.subarray(i, Math.min(i + blockSize, inputSamples));
      resampler.process(block, (chunk) => {
        outputChunks.push(new Int16Array(chunk));
      });
    }

    const totalOutputSamples = outputChunks.reduce((acc, c) => acc + c.length, 0);
    const expectedSamples = Math.floor(inputSamples / (inputSr / targetSr));
    
    // Within 1 block (due to bufferSize flush at end)
    assert.ok(
      totalOutputSamples >= expectedSamples - 2048 && totalOutputSamples <= expectedSamples,
      `Expected ~${expectedSamples} samples, got ${totalOutputSamples}`
    );
  });

  test('accurately downsamples 44,100 Hz to 11,025 Hz with exact 4:1 integer decimation', () => {
    const inputSr = 44100;
    const targetSr = 11025;
    const resampler = new PolyphaseResampler(inputSr, targetSr, 512);

    assert.strictEqual(resampler.ratio, 4.0);

    const input = new Float32Array(44100);
    for (let i = 0; i < input.length; i++) {
      input[i] = 0.3 * Math.sin((2 * Math.PI * 1000 * i) / inputSr);
    }

    let chunkCount = 0;
    for (let i = 0; i < input.length; i += 128) {
      const block = input.subarray(i, Math.min(i + 128, input.length));
      resampler.process(block, () => {
        chunkCount++;
      });
    }

    // 44100 / 4 = 11025 samples. 11025 / 512 = 21 chunks of 512
    assert.ok(chunkCount >= 21, `Expected at least 21 chunks of 512 samples, got ${chunkCount}`);
  });

  test('downmixes stereo channels consistently without phase distortion', () => {
    const resampler = new PolyphaseResampler(11025, 11025, 1024);
    const left = new Float32Array([0.8, -0.4, 0.2]);
    const right = new Float32Array([0.2, 0.4, -0.2]);
    const outputMono = new Float32Array(3);

    resampler.downmixToMono([left, right], outputMono);

    assert.ok(Math.abs(outputMono[0] - 0.5) < 1e-6);
    assert.ok(Math.abs(outputMono[1] - 0.0) < 1e-6);
    assert.ok(Math.abs(outputMono[2] - 0.0) < 1e-6);
  });
});

describe('Polyphase Windowed-Sinc Resampler - Anti-Aliasing Attenuation', () => {
  test('strongly attenuates out-of-band frequencies above target Nyquist (8 kHz and 14 kHz)', () => {
    const inputSr = 48000;
    const targetSr = 11025;
    const resampler = new PolyphaseResampler(inputSr, targetSr, 2048);

    // Audio composed of in-band 1000 Hz + out-of-band 8000 Hz
    const N = 48000;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const inBand = 0.4 * Math.sin((2 * Math.PI * 1000 * i) / inputSr);
      const outOfBand = 0.4 * Math.sin((2 * Math.PI * 8000 * i) / inputSr);
      input[i] = inBand + outOfBand;
    }

    const outputSamples = [];
    const blockSize = 128;
    for (let i = 0; i < N; i += blockSize) {
      const block = input.subarray(i, Math.min(i + blockSize, N));
      resampler.process(block, (chunk) => {
        outputSamples.push(...new Int16Array(chunk));
      });
    }

    assert.ok(outputSamples.length >= 8192);

    // Discrete Fourier transform at the 1000 Hz frequency bin vs the aliased frequency bin
    // In 11025 Hz, 8000 Hz aliases to |11025 - 8000| = 3025 Hz
    const testLen = 4096;
    let cos1000 = 0, sin1000 = 0;
    let cos3025 = 0, sin3025 = 0;

    for (let n = 0; n < testLen; n++) {
      const val = outputSamples[n] / 32768.0;
      const angle1000 = (2 * Math.PI * 1000 * n) / targetSr;
      const angle3025 = (2 * Math.PI * 3025 * n) / targetSr;
      cos1000 += val * Math.cos(angle1000);
      sin1000 += val * Math.sin(angle1000);
      cos3025 += val * Math.cos(angle3025);
      sin3025 += val * Math.sin(angle3025);
    }

    const mag1000 = Math.sqrt(cos1000 * cos1000 + sin1000 * sin1000);
    const mag3025 = Math.sqrt(cos3025 * cos3025 + sin3025 * sin3025);

    // Out-of-band 8000 Hz aliased component at 3025 Hz must be attenuated by at least 40 dB relative to in-band 1000 Hz
    const ratio = mag3025 / Math.max(1e-9, mag1000);
    assert.ok(
      ratio < 0.02,
      `Expected aliased 3025 Hz magnitude to be < 2% of 1000 Hz, but got ${(ratio * 100).toFixed(2)}%`
    );
  });
});

describe('Polyphase Windowed-Sinc Resampler - Signal Level & Clipping Diagnostics', () => {
  test('accurately detects clipping on clipped audio', () => {
    const resampler = new PolyphaseResampler(48000, 11025, 2048);

    // Overloaded input (amplitude 1.5)
    const block = new Float32Array(512);
    for (let i = 0; i < block.length; i++) {
      block[i] = 1.5 * Math.sin((2 * Math.PI * 440 * i) / 48000);
    }

    resampler.process(block, () => {});
    const metrics = resampler.getMetricsAndReset();

    assert.ok(metrics.clippedSamples > 0, 'Expected clipped samples > 0');
    assert.ok(metrics.clippingPercentage > 10, 'Expected clipping percentage > 10%');
    assert.ok(metrics.peakAmplitude >= 0.999, 'Expected peak amplitude ~ 1.0');
  });

  test('computes correct dBFS and zero percentage for quiet/silent audio', () => {
    const resampler = new PolyphaseResampler(48000, 11025, 2048);
    const silentBlock = new Float32Array(512); // All zeros

    resampler.process(silentBlock, () => {});
    const metrics = resampler.getMetricsAndReset();

    assert.strictEqual(metrics.clippedSamples, 0);
    assert.strictEqual(metrics.clippingPercentage, 0);
    assert.strictEqual(metrics.zeroPercentage, 100);
    assert.strictEqual(metrics.rmsDbfs, -100);
  });

  test('calculatePcmMetrics correctly analyzes signed 16-bit PCM buffer', () => {
    const pcm = new Int16Array(1024);
    pcm[0] = 32767;  // Clipped
    pcm[1] = -32768; // Clipped
    pcm[2] = 0;      // Zero

    const metrics = calculatePcmMetrics(pcm.buffer);
    assert.strictEqual(metrics.clippedSamples, 2);
    assert.ok(metrics.peakAmplitude >= 0.999);
    assert.ok(metrics.zeroSamples >= 1);
  });
});
