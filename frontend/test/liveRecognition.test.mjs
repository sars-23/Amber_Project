import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Pure functions mirroring the live recognition streaming logic
 * for protocol handling, RMS level monitoring, and diagnostic calculation.
 */

export function calculatePcmRms(pcm16Buffer) {
  const pcm16 = new Int16Array(pcm16Buffer);
  if (pcm16.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < pcm16.length; i++) {
    const norm = pcm16[i] / 32768.0;
    sumSq += norm * norm;
  }
  return Math.sqrt(sumSq / pcm16.length);
}

export function rmsToDbfs(rms) {
  if (rms <= 0.00001) return -100;
  const rounded = Math.round(20 * Math.log10(rms));
  return Math.max(-100, rounded === 0 ? 0 : rounded);
}

export function parseStreamMessage(rawJson) {
  try {
    const data = JSON.parse(rawJson);
    if (!data || typeof data !== 'object') {
      return { type: 'UNKNOWN', valid: false, error: 'Not an object' };
    }

    switch (data.type) {
      case 'STREAM_READY':
        return {
          type: 'STREAM_READY',
          valid: true,
          sessionId: data.sessionId ?? '',
          targetSampleRate: data.targetSampleRate ?? 11025,
          minAudioDurationSeconds: data.minAudioDurationSeconds ?? 2.0,
          maxAudioDurationSeconds: data.maxAudioDurationSeconds ?? 12.0,
          bufferCapacitySeconds: data.bufferCapacitySeconds ?? 30.0,
        };

      case 'MATCH_UPDATE':
        return {
          type: 'MATCH_UPDATE',
          valid: true,
          matched: Boolean(data.matched),
          song: data.song ?? null,
          confidence: data.confidence ?? 0,
          peakVotes: data.peakVotes ?? 0,
          coherence: data.coherence ?? 0,
          margin: data.margin ?? 0,
          queryFingerprints: data.queryFingerprints ?? 0,
          receivedSamples: data.receivedSamples ?? 0,
          windowSamples: data.windowSamples ?? 0,
          message: data.message ?? '',
        };

      case 'STREAM_ERROR':
        return {
          type: 'STREAM_ERROR',
          valid: true,
          errorCode: data.errorCode ?? 'PROCESSING_ERROR',
          message: data.message ?? 'Unknown audio processing error',
        };

      case 'RESET_ACK':
        return {
          type: 'RESET_ACK',
          valid: true,
        };

      default:
        return {
          type: data.type ?? 'UNKNOWN',
          valid: false,
          error: `Unrecognized message type: ${data.type}`,
        };
    }
  } catch (err) {
    return {
      type: 'MALFORMED',
      valid: false,
      error: err instanceof Error ? err.message : 'JSON parse error',
    };
  }
}

export function samplesToDurationSeconds(sampleCount, sampleRate = 11025) {
  if (!sampleCount || sampleCount <= 0 || sampleRate <= 0) return 0;
  return Math.round((sampleCount / sampleRate) * 10) / 10;
}

describe('Live Recognition - RMS Level Monitoring', () => {
  test('computes zero RMS for silent PCM buffer', () => {
    const buffer = new Int16Array(1024).buffer;
    const rms = calculatePcmRms(buffer);
    assert.strictEqual(rms, 0);
    assert.strictEqual(rmsToDbfs(rms), -100);
  });

  test('computes correct RMS for full-scale square wave (+-32767)', () => {
    const pcm = new Int16Array(1024);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = i % 2 === 0 ? 32767 : -32767;
    }
    const rms = calculatePcmRms(pcm.buffer);
    assert.ok(Math.abs(rms - 1.0) < 0.001, `Expected RMS ~ 1.0, got ${rms}`);
    assert.strictEqual(rmsToDbfs(rms), 0);
  });

  test('computes correct dBFS for intermediate audio signal', () => {
    // 0.1 amplitude corresponds to -20 dBFS
    const pcm = new Int16Array(1000);
    const targetAmp = 3277; // ~0.1
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = targetAmp;
    }
    const rms = calculatePcmRms(pcm.buffer);
    const dbfs = rmsToDbfs(rms);
    assert.ok(dbfs >= -21 && dbfs <= -19, `Expected ~ -20 dBFS, got ${dbfs}`);
  });
});

describe('Live Recognition - WebSocket Protocol Message Handling', () => {
  test('parses STREAM_READY handshake message', () => {
    const raw = JSON.stringify({
      type: 'STREAM_READY',
      sessionId: 'sess-abc-123',
      targetSampleRate: 11025,
      minAudioDurationSeconds: 2.0,
      maxAudioDurationSeconds: 12.0,
      bufferCapacitySeconds: 30.0,
    });
    const parsed = parseStreamMessage(raw);
    assert.strictEqual(parsed.valid, true);
    assert.strictEqual(parsed.type, 'STREAM_READY');
    assert.strictEqual(parsed.sessionId, 'sess-abc-123');
    assert.strictEqual(parsed.targetSampleRate, 11025);
    assert.strictEqual(parsed.minAudioDurationSeconds, 2.0);
  });

  test('parses MATCH_UPDATE when song is matched', () => {
    const raw = JSON.stringify({
      type: 'MATCH_UPDATE',
      matched: true,
      song: {
        id: 42,
        title: 'Echoes of Amber',
        artist: 'The Antigravity Trio',
      },
      confidence: 0.94,
      peakVotes: 120,
      coherence: 0.88,
      margin: 3.5,
      queryFingerprints: 450,
      receivedSamples: 33075,
      windowSamples: 33075,
      message: 'Positive match identified with high confidence.',
    });
    const parsed = parseStreamMessage(raw);
    assert.strictEqual(parsed.valid, true);
    assert.strictEqual(parsed.matched, true);
    assert.strictEqual(parsed.song?.title, 'Echoes of Amber');
    assert.strictEqual(parsed.confidence, 0.94);
    assert.strictEqual(parsed.peakVotes, 120);
    assert.strictEqual(parsed.queryFingerprints, 450);
  });

  test('parses MATCH_UPDATE when no match found (listening continuous)', () => {
    const raw = JSON.stringify({
      type: 'MATCH_UPDATE',
      matched: false,
      song: null,
      confidence: 0.05,
      peakVotes: 3,
      coherence: 0.12,
      margin: 1.0,
      queryFingerprints: 110,
      receivedSamples: 22050,
      windowSamples: 22050,
      message: 'Listening: insufficient coherent match peaks yet.',
    });
    const parsed = parseStreamMessage(raw);
    assert.strictEqual(parsed.valid, true);
    assert.strictEqual(parsed.matched, false);
    assert.strictEqual(parsed.song, null);
    assert.strictEqual(parsed.receivedSamples, 22050);
  });

  test('parses STREAM_ERROR payload from backend', () => {
    const raw = JSON.stringify({
      type: 'STREAM_ERROR',
      errorCode: 'AUDIO_DECODE_ERROR',
      message: 'Failed to process audio stream chunk.',
    });
    const parsed = parseStreamMessage(raw);
    assert.strictEqual(parsed.valid, true);
    assert.strictEqual(parsed.type, 'STREAM_ERROR');
    assert.strictEqual(parsed.errorCode, 'AUDIO_DECODE_ERROR');
    assert.match(parsed.message, /Failed to process/);
  });

  test('safely rejects malformed JSON', () => {
    const parsed = parseStreamMessage('NOT_VALID_JSON{:::');
    assert.strictEqual(parsed.valid, false);
    assert.strictEqual(parsed.type, 'MALFORMED');
  });

  test('calculates correct duration in seconds from sample count', () => {
    assert.strictEqual(samplesToDurationSeconds(11025, 11025), 1.0);
    assert.strictEqual(samplesToDurationSeconds(22050, 11025), 2.0);
    assert.strictEqual(samplesToDurationSeconds(33075, 11025), 3.0);
    assert.strictEqual(samplesToDurationSeconds(0, 11025), 0);
  });
});
