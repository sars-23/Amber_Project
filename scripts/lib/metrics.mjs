import { normalizeTrackKey } from './audio-validator.mjs';

/**
 * Calculates comprehensive statistical metrics for recognition evaluation.
 *
 * @param {Array<Object>} queryResults - Array of processed evaluation query records
 * @param {Object} [options]
 * @param {number} [options.offsetToleranceMs=250] - Threshold in ms for considering offset accurate
 * @returns {Object} Comprehensive evaluation metrics
 */
export function calculateEvaluationMetrics(queryResults, options = {}) {
  const toleranceMs = options.offsetToleranceMs || 250;

  const totalExecuted = queryResults.length;
  let failedRequests = 0;
  let correctMatches = 0;
  let falseNegatives = 0;
  let falsePositives = 0;
  let negativeControlMatches = 0;
  let negativeControlTotal = 0;

  const offsetErrors = [];
  const withinToleranceOffsets = [];
  const latencies = [];

  // Group by label for segmented breakdown
  const labelGroups = new Map();

  for (const q of queryResults) {
    const label = q.label || 'default';
    if (!labelGroups.has(label)) {
      labelGroups.set(label, []);
    }
    labelGroups.get(label).push(q);

    if (q.error) {
      failedRequests++;
      continue;
    }

    if (typeof q.latencyMs === 'number' && !isNaN(q.latencyMs)) {
      latencies.push(q.latencyMs);
    }

    const hasExpectedSong = Boolean(q.expectedTitle && q.expectedTitle.trim().length > 0);

    if (!hasExpectedSong) {
      // Negative control test (expecting no match)
      negativeControlTotal++;
      if (q.matched) {
        negativeControlMatches++;
        falsePositives++;
      }
      continue;
    }

    if (!q.matched) {
      // Expected a song, but server found nothing -> False Negative
      falseNegatives++;
      continue;
    }

    // Server returned a match -> check if it's the expected song
    const matchedKey = q.matchedSong ? normalizeTrackKey(q.matchedSong.title, q.matchedSong.artist) : '';
    const expectedKey = normalizeTrackKey(q.expectedTitle, q.expectedArtist);

    const isSameSong = matchedKey.length > 0 && matchedKey === expectedKey;

    if (isSameSong) {
      correctMatches++;

      // Evaluate temporal offset accuracy
      if (typeof q.expectedOffsetMs === 'number' && !isNaN(q.expectedOffsetMs)) {
        const errorMs = Math.abs(q.estimatedOffsetMs - q.expectedOffsetMs);
        offsetErrors.push(errorMs);
        if (errorMs <= toleranceMs) {
          withinToleranceOffsets.push(errorMs);
        }
      }
    } else {
      // Matched the wrong song -> False Positive
      falsePositives++;
    }
  }

  const expectedTotal = totalExecuted - negativeControlTotal - failedRequests;
  const matchRate = expectedTotal > 0 ? (correctMatches / expectedTotal) * 100 : 0;
  const falseNegativeRate = expectedTotal > 0 ? (falseNegatives / expectedTotal) * 100 : 0;
  const falsePositiveRate = (expectedTotal + negativeControlTotal) > 0
    ? (falsePositives / (expectedTotal + negativeControlTotal)) * 100
    : 0;

  // Offset statistics
  const offsetMae = offsetErrors.length > 0
    ? offsetErrors.reduce((acc, v) => acc + v, 0) / offsetErrors.length
    : null;

  const offsetWithinToleranceRate = offsetErrors.length > 0
    ? (withinToleranceOffsets.length / offsetErrors.length) * 100
    : null;

  // Latency percentiles
  latencies.sort((a, b) => a - b);
  const latencyMin = latencies.length > 0 ? latencies[0] : null;
  const latencyMax = latencies.length > 0 ? latencies[latencies.length - 1] : null;
  const latencyMean = latencies.length > 0
    ? Math.round(latencies.reduce((acc, v) => acc + v, 0) / latencies.length)
    : null;
  const latencyP50 = calculatePercentile(latencies, 50);
  const latencyP95 = calculatePercentile(latencies, 95);

  // Per-label breakdown
  const breakdownByLabel = {};
  for (const [lbl, group] of labelGroups.entries()) {
    const groupExpected = group.filter(g => g.expectedTitle && !g.error);
    const groupCorrect = group.filter(g => {
      if (!g.matched || !g.matchedSong || g.error) return false;
      return normalizeTrackKey(g.matchedSong.title, g.matchedSong.artist) === normalizeTrackKey(g.expectedTitle, g.expectedArtist);
    });
    const groupOffsets = groupCorrect
      .filter(g => typeof g.expectedOffsetMs === 'number')
      .map(g => Math.abs(g.estimatedOffsetMs - g.expectedOffsetMs));
    const groupLatencies = group.map(g => g.latencyMs).filter(l => typeof l === 'number');

    breakdownByLabel[lbl] = {
      total: group.length,
      expected: groupExpected.length,
      correctMatches: groupCorrect.length,
      matchRatePercent: groupExpected.length > 0 ? Number(((groupCorrect.length / groupExpected.length) * 100).toFixed(1)) : 0,
      offsetMaeMs: groupOffsets.length > 0 ? Number((groupOffsets.reduce((a, b) => a + b, 0) / groupOffsets.length).toFixed(1)) : null,
      medianLatencyMs: calculatePercentile(groupLatencies.sort((a, b) => a - b), 50)
    };
  }

  return {
    summary: {
      totalExecuted,
      expectedMatches: expectedTotal,
      negativeControls: negativeControlTotal,
      failedRequests,
      correctMatches,
      falseNegatives,
      falsePositives,
      matchRatePercent: Number(matchRate.toFixed(2)),
      falseNegativeRatePercent: Number(falseNegativeRate.toFixed(2)),
      falsePositiveRatePercent: Number(falsePositiveRate.toFixed(2))
    },
    offsetAccuracy: {
      evaluatedCount: offsetErrors.length,
      toleranceMs,
      withinToleranceCount: withinToleranceOffsets.length,
      withinToleranceRatePercent: offsetWithinToleranceRate !== null ? Number(offsetWithinToleranceRate.toFixed(2)) : null,
      meanAbsoluteErrorMs: offsetMae !== null ? Number(offsetMae.toFixed(2)) : null,
      minErrorMs: offsetErrors.length > 0 ? Math.min(...offsetErrors) : null,
      maxErrorMs: offsetErrors.length > 0 ? Math.max(...offsetErrors) : null
    },
    latencyDistribution: {
      sampleCount: latencies.length,
      minMs: latencyMin,
      maxMs: latencyMax,
      meanMs: latencyMean,
      p50MedianMs: latencyP50,
      p95Ms: latencyP95
    },
    breakdownByLabel
  };
}

/**
 * Calculates a specific percentile from a sorted numeric array.
 *
 * @param {number[]} sortedArr
 * @param {number} p - Percentile between 0 and 100
 * @returns {number|null}
 */
export function calculatePercentile(sortedArr, p) {
  if (!sortedArr || sortedArr.length === 0) return null;
  if (sortedArr.length === 1) return sortedArr[0];
  const rank = (p / 100) * (sortedArr.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const weight = rank - lowerIndex;
  return Math.round(sortedArr[lowerIndex] * (1 - weight) + sortedArr[upperIndex] * weight);
}
