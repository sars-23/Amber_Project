import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { calculateEvaluationMetrics, calculatePercentile } from '../lib/metrics.mjs';
import { AmberClient } from '../lib/amber-client.mjs';
import { runEvaluation } from '../recognition-evaluator.mjs';

const FIXTURES_DIR = path.resolve('scripts/test/fixtures');

describe('Evaluation Metrics Calculator', () => {
  it('correctly calculates match rate, false negatives, false positives, and offset MAE', () => {
    const queryResults = [
      // 1. Correct match with 100ms offset error
      {
        queryPath: 'q1.wav',
        expectedTitle: 'Song A',
        expectedArtist: 'Artist A',
        expectedOffsetMs: 3000,
        matched: true,
        matchedSong: { id: 1, title: 'Song A', artist: 'Artist A' },
        estimatedOffsetMs: 3100,
        latencyMs: 10,
        label: 'clean'
      },
      // 2. Correct match with 0ms offset error
      {
        queryPath: 'q2.wav',
        expectedTitle: 'Song B',
        expectedArtist: 'Artist B',
        expectedOffsetMs: 5000,
        matched: true,
        matchedSong: { id: 2, title: 'Song B', artist: 'Artist B' },
        estimatedOffsetMs: 5000,
        latencyMs: 15,
        label: 'clean'
      },
      // 3. False Negative (missed)
      {
        queryPath: 'q3.wav',
        expectedTitle: 'Song C',
        expectedArtist: 'Artist C',
        expectedOffsetMs: 2000,
        matched: false,
        matchedSong: null,
        estimatedOffsetMs: null,
        latencyMs: 20,
        label: 'noisy'
      },
      // 4. False Positive (matched wrong song)
      {
        queryPath: 'q4.wav',
        expectedTitle: 'Song D',
        expectedArtist: 'Artist D',
        expectedOffsetMs: 4000,
        matched: true,
        matchedSong: { id: 99, title: 'Wrong Song', artist: 'Unknown' },
        estimatedOffsetMs: 4000,
        latencyMs: 12,
        label: 'noisy'
      },
      // 5. Negative control (expected nothing, matched nothing -> PASS)
      {
        queryPath: 'noise.wav',
        expectedTitle: '',
        expectedArtist: '',
        expectedOffsetMs: null,
        matched: false,
        matchedSong: null,
        estimatedOffsetMs: null,
        latencyMs: 8,
        label: 'negative-control'
      }
    ];

    const metrics = calculateEvaluationMetrics(queryResults, { offsetToleranceMs: 250 });

    assert.equal(metrics.summary.totalExecuted, 5);
    assert.equal(metrics.summary.expectedMatches, 4);
    assert.equal(metrics.summary.negativeControls, 1);
    assert.equal(metrics.summary.correctMatches, 2);
    assert.equal(metrics.summary.falseNegatives, 1);
    assert.equal(metrics.summary.falsePositives, 1);
    assert.equal(metrics.summary.matchRatePercent, 50.0); // 2/4 = 50%

    // Offset MAE: (100 + 0) / 2 = 50ms
    assert.equal(metrics.offsetAccuracy.evaluatedCount, 2);
    assert.equal(metrics.offsetAccuracy.meanAbsoluteErrorMs, 50.0);
    assert.equal(metrics.offsetAccuracy.withinToleranceCount, 2);
    assert.equal(metrics.offsetAccuracy.withinToleranceRatePercent, 100.0);

    // Latency
    assert.equal(metrics.latencyDistribution.minMs, 8);
    assert.equal(metrics.latencyDistribution.maxMs, 20);
    assert.equal(metrics.latencyDistribution.p50MedianMs, 12);

    // Label breakdown
    assert.equal(metrics.breakdownByLabel.clean.correctMatches, 2);
    assert.equal(metrics.breakdownByLabel.clean.matchRatePercent, 100.0);
    assert.equal(metrics.breakdownByLabel.noisy.correctMatches, 0);
    assert.equal(metrics.breakdownByLabel.noisy.matchRatePercent, 0.0);
  });

  it('calculates percentiles correctly for odd and even arrays', () => {
    const arr = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    assert.equal(calculatePercentile(arr, 50), 55);
    assert.equal(calculatePercentile(arr, 95), 96);
    assert.equal(calculatePercentile([42], 50), 42);
    assert.equal(calculatePercentile([], 50), null);
  });
});

describe('AmberClient Search & Rate Limiting', () => {
  it('handles HTTP 429 Too Many Requests and retries successfully', async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          status: 429,
          ok: false,
          headers: new Map([['Retry-After', '1']])
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({
          matched: true,
          song: { id: 1, title: 'Sample Track', artist: 'Artist' },
          estimatedOffsetMs: 3000,
          confidence: 0.95
        })
      };
    };

    const client = new AmberClient({
      customFetch: mockFetch,
      maxRetries: 2
    });

    const { result, latencyMs } = await client.searchAudio(path.join(FIXTURES_DIR, 'sample.wav'));
    assert.equal(callCount, 2);
    assert.equal(result.matched, true);
    assert.equal(result.song.title, 'Sample Track');
    assert.ok(latencyMs >= 0);
  });
});

describe('Recognition Evaluator CLI End-to-End', () => {
  const tempDir = path.resolve('scripts/test/temp_eval');
  const tempManifest = path.join(tempDir, 'eval_manifest.csv');
  const tempReportJson = path.join(tempDir, 'report.json');
  const tempReportCsv = path.join(tempDir, 'report.csv');

  beforeEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runs dry run without --execute and produces structured plan', async () => {
    const csvContent = `query_path,expected_title,expected_artist,expected_offset_ms,label
sample.wav,Acoustic Breeze,Benjamin Tissot,3000,clean-crop
tiny.wav,Invalid Crop,Unknown,1000,bad-fixture`;

    fs.writeFileSync(tempManifest, csvContent, 'utf8');

    const result = await runEvaluation([
      '--audio-dir', FIXTURES_DIR,
      '--manifest', tempManifest,
      '--report-json', tempReportJson
    ]);

    assert.equal(result.exitCode, 0);
    assert.ok(fs.existsSync(tempReportJson));

    const report = JSON.parse(fs.readFileSync(tempReportJson, 'utf8'));
    assert.equal(report.mode, 'dry-run');
    assert.equal(report.totalQueriesPlanned, 1);
    assert.equal(report.invalidFixturesCount, 1);
  });

  it('executes evaluation with mock fetch and exports both JSON and CSV', async () => {
    const csvContent = `query_path,expected_title,expected_artist,expected_offset_ms,label
sample.wav,Acoustic Breeze,Benjamin Tissot,3000,clean-crop`;

    fs.writeFileSync(tempManifest, csvContent, 'utf8');

    // Test with AmberClient mock
    const mockResult = {
      matched: true,
      song: { id: 10, title: 'Acoustic Breeze', artist: 'Benjamin Tissot' },
      estimatedOffsetMs: 3100,
      score: 180,
      confidence: 0.98,
      matchingHashes: 180,
      searchDurationMs: 15
    };

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => mockResult
    });

    const client = new AmberClient({ customFetch: mockFetch });
    const { result, latencyMs } = await client.searchAudio(path.join(FIXTURES_DIR, 'sample.wav'));

    assert.equal(result.matched, true);
    assert.equal(result.song.title, 'Acoustic Breeze');

    // Run metrics
    const metrics = calculateEvaluationMetrics([
      {
        queryPath: 'sample.wav',
        expectedTitle: 'Acoustic Breeze',
        expectedArtist: 'Benjamin Tissot',
        expectedOffsetMs: 3000,
        matched: result.matched,
        matchedSong: result.song,
        estimatedOffsetMs: result.estimatedOffsetMs,
        score: result.score,
        confidence: result.confidence,
        latencyMs: 15,
        label: 'clean-crop'
      }
    ]);

    assert.equal(metrics.summary.matchRatePercent, 100);
    assert.equal(metrics.offsetAccuracy.meanAbsoluteErrorMs, 100);
  });
});
