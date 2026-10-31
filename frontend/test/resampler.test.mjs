import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PolyphaseResampler, calculatePcmMetrics } from '../src/utils/resampler.ts';

describe('Polyphase Resampler - Symmetry and Coefficient Alignment', () => {
  test('Phase 0 coefficients are genuinely and perfectly symmetric for 44.1 kHz, 48 kHz, and 96 kHz', () => {
    for (const rate of [44100, 48000, 96000]) {
      const resampler = new PolyphaseResampler(rate, 11025, 2048);
      const numTaps = resampler.numTaps;
      assert.strictEqual(numTaps % 2, 1, 'Filter length must be odd for true symmetry');

      const h0 = resampler.polyTable.subarray(0, numTaps);
      const M = resampler.filterHalfLength;

      // Check symmetry: h0[M - k] === h0[M + k] for all k
      let maxDev = 0.0;
      for (let k = 1; k <= M; k++) {
        const left = h0[M - k];
        const right = h0[M + k];
        const dev = Math.abs(left - right);
        if (dev > maxDev) maxDev = dev;
      }

      assert.ok(
        maxDev < 1e-6,
        `Phase 0 for ${rate} Hz must be symmetric. Max deviation: ${maxDev}`
      );
    }
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

    assert.ok(chunkCount >= 21, `Expected at least 21 chunks of 512 samples, got ${chunkCount}`);
  });

  test('accurately downsamples 48,000 Hz to 11,025 Hz with correct sample count', () => {
    const inputSr = 48000;
    const targetSr = 11025;
    const durationSec = 1.0;
    const inputSamples = inputSr * durationSec;
    const resampler = new PolyphaseResampler(inputSr, targetSr, 2048);

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

    assert.ok(
      totalOutputSamples >= expectedSamples - 2048 && totalOutputSamples <= expectedSamples,
      `Expected ~${expectedSamples} samples, got ${totalOutputSamples}`
    );
  });
});

describe('Polyphase Resampler - Frequency Response and Stopband Attenuation', () => {
  test('stopband attenuation exceeds 50 dB across all 128 phases at frequencies >= 5,750 Hz', () => {
    for (const rate of [44100, 48000]) {
      const resampler = new PolyphaseResampler(rate, 11025, 2048);
      const M = resampler.filterHalfLength;
      const numTaps = resampler.numTaps;
      const P = resampler.phases;

      const stopbandFreqs = [5750, 6000, 8000, 12000, 16000];

      for (const f of stopbandFreqs) {
        if (f >= rate / 2) continue;
        const w = (2.0 * Math.PI * f) / rate;

        for (let p = 0; p < P; p++) {
          const offset = p * numTaps;
          let real = 0.0;
          let imag = 0.0;

          for (let idx = 0; idx < numTaps; idx++) {
            const k = idx - M;
            const coeff = resampler.polyTable[offset + idx];
            real += coeff * Math.cos(-w * k);
            imag += coeff * Math.sin(-w * k);
          }

          const mag = Math.sqrt(real * real + imag * imag);
          const magDb = 20 * Math.log10(Math.max(1e-9, mag));

          assert.ok(
            magDb < -50.0,
            `Phase ${p} at ${f} Hz for ${rate} Hz must have attenuation < -50 dB, got ${magDb.toFixed(2)} dB`
          );
        }
      }
    }
  });

  test('passband frequency response is flat (< 0.1 dB loss) up to 4,000 Hz', () => {
    const resampler = new PolyphaseResampler(48000, 11025, 2048);
    const M = resampler.filterHalfLength;
    const numTaps = resampler.numTaps;
    const passbandFreqs = [440, 1000, 3000, 4000];

    for (const f of passbandFreqs) {
      const w = (2.0 * Math.PI * f) / 48000;
      let real = 0.0;
      let imag = 0.0;

      for (let idx = 0; idx < numTaps; idx++) {
        const k = idx - M;
        const coeff = resampler.polyTable[idx];
        real += coeff * Math.cos(-w * k);
        imag += coeff * Math.sin(-w * k);
      }

      const mag = Math.sqrt(real * real + imag * imag);
      const magDb = 20 * Math.log10(mag);

      assert.ok(
        Math.abs(magDb) < 0.1,
        `Passband at ${f} Hz must be flat (< 0.1 dB), got ${magDb.toFixed(3)} dB`
      );
    }
  });
});

describe('Polyphase Resampler - DC Blocker and Signal Observability', () => {
  test('20 Hz DC blocker eliminates severe hardware ADC offset', () => {
    const resampler = new PolyphaseResampler(48000, 11025, 2048);

    // Audio with -0.5 (-16,384) DC offset
    const N = 48000;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      input[i] = -0.5 + 0.1 * Math.sin((2 * Math.PI * 440 * i) / 48000);
    }

    const outputMono = new Float32Array(N);
    resampler.downmixToMono(input, outputMono);

    // After initial 1000 samples filter settle, DC offset must be near zero
    let sum = 0.0;
    for (let i = 2000; i < N; i++) {
      sum += outputMono[i];
    }
    const settledMean = sum / (N - 2000);

    assert.ok(
      Math.abs(settledMean) < 0.01,
      `DC offset must be eliminated (< 0.01), got ${settledMean.toFixed(4)}`
    );
  });

  test('accurately detects signal clipping and dBFS', () => {
    const resampler = new PolyphaseResampler(48000, 11025, 2048);
    const block = new Float32Array(512);
    for (let i = 0; i < block.length; i++) {
      block[i] = 1.2 * Math.sin((2 * Math.PI * 440 * i) / 48000);
    }

    resampler.process(block, () => {});
    const metrics = resampler.getMetricsAndReset();

    assert.ok(metrics.clippedSamples > 0, 'Expected clipped samples > 0');
    assert.ok(metrics.clippingPercentage > 5.0, 'Expected clipping percentage > 5%');
    assert.ok(metrics.peakAmplitude >= 0.999);
  });

  test('calculatePcmMetrics correctly analyzes signed 16-bit PCM buffer', () => {
    const pcm = new Int16Array(1024);
    pcm[0] = 32767;
    pcm[1] = -32768;
    pcm[2] = 0;

    const metrics = calculatePcmMetrics(pcm.buffer);
    assert.strictEqual(metrics.clippedSamples, 2);
    assert.ok(metrics.peakAmplitude >= 0.999);
    assert.ok(metrics.zeroSamples >= 1);
  });
});
