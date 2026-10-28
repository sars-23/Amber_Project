import { normalizeTrackKey } from './audio-validator.mjs';

/**
 * Calculates statistically sound recognition evaluation metrics.
 *
 * Formulas:
 * 1. Identification Rate (%):
 *    (correctMatches / expectedMatches) * 100
 *    - correctMatches: expected-match query where matched == true AND matchedSong matches expected title/artist.
 *    - expectedMatches: valid expected-match queries (excluding request errors).
 * 2. Missed Expected Matches Rate (%):
 *    (missedExpectedMatches / expectedMatches) * 100
 *    - missedExpectedMatches: expected-match query where server returned matched == false.
 * 3. Wrong-Song Identification Rate (%):
 *    (wrongSongIdentifications / expectedMatches) * 100
 *    - wrongSongIdentifications: expected-match query where server returned matched == true but matched wrong song.
 * 4. Negative-Control False-Positive Rate (%):
 *    (negativeControlFalsePositives / negativeControls) * 100
 *    - negativeControlFalsePositives: negative-control query that incorrectly returned a match.
 *    - negativeControls: valid negative-control queries (excluding request errors).
 *    - Evaluates to null if negativeControls === 0 (e.g. dataset without negative controls).
 * 5. Negative-Control True-Negative Rate (%):
 *    (negativeControlTrueNegatives / negativeControls) * 100
 *    - negativeControlTrueNegatives: negative-control query that correctly returned no match.
 *    - Evaluates to null if negativeControls === 0.
 * 6. Offset Mean Absolute Error (MAE):
 *    Mean absolute error computed strictly for correct identifications with valid numeric estimated and expected offsets.
 *    Missing or null estimated offsets are never treated as zero; they are counted as unavailable.
 * 7. Latency Percentiles:
 *    Computed strictly from actual numeric request latencies.
 *
 * @param {Array<Object>} queryResults - Processed evaluation query records
 * @param {Object} [options]
 * @param {number} [options.offsetToleranceMs=250] - Threshold in ms for considering offset within tolerance
 * @returns {Object} Comprehensive evaluation metrics
 */
export function calculateEvaluationMetrics(queryResults, options = {}) {
  const toleranceMs = options.offsetToleranceMs || 250;

  const totalExecuted = queryResults.length;
  let failedRequests = 0;

  // Expected-match query metrics
  let expectedMatches = 0;
  let correctMatches = 0;
  let missedExpectedMatches = 0; // False negatives on expected songs
  let wrongSongIdentifications = 0; // Wrong song identified on expected query

  // Negative-control query metrics
  let negativeControls = 0;
  let negativeControlTrueNegatives = 0;
  let negativeControlFalsePositives = 0;

  // Offset metrics
  const offsetErrors = [];
  const withinToleranceOffsets = [];
  let offsetUnavailableCount = 0;

  // Latency metrics
  const latencies = [];

  // Group by label for segmented breakdown
  const labelGroups = new Map();

  for (const q of queryResults) {
    const label = q.label || 'default';
    if (!labelGroups.has(label)) {
      labelGroups.set(label, []);
    }
    labelGroups.get(label).push(q);

    // Keep request failures strictly separate from recognition outcomes
    if (q.error) {
      failedRequests++;
      continue;
    }

    if (typeof q.latencyMs === 'number' && !isNaN(q.latencyMs)) {
      latencies.push(q.latencyMs);
    }

    const hasExpectedSong = Boolean(q.expectedTitle && q.expectedTitle.trim().length > 0);

    if (!hasExpectedSong) {
      // Negative control query (ground truth: should not match anything)
      negativeControls++;
      if (q.matched) {
        negativeControlFalsePositives++;
      } else {
        negativeControlTrueNegatives++;
      }
      continue;
    }

    // Expected target song query (ground truth: should match this specific track)
    expectedMatches++;

    if (!q.matched) {
      // Expected song, but server returned no match -> Missed
      missedExpectedMatches++;
      continue;
    }

    // Server returned a match -> check whether it matched the expected song
    const matchedKey = q.matchedSong ? normalizeTrackKey(q.matchedSong.title, q.matchedSong.artist) : '';
    const expectedKey = normalizeTrackKey(q.expectedTitle, q.expectedArtist);

    const isSameSong = matchedKey.length > 0 && matchedKey === expectedKey;

    if (isSameSong) {
      correctMatches++;

      // Evaluate temporal offset accuracy only when both expected and estimated offsets are valid numbers
      const hasNumericExpected = typeof q.expectedOffsetMs === 'number' && !isNaN(q.expectedOffsetMs);
      const hasNumericEstimated = typeof q.estimatedOffsetMs === 'number' && !isNaN(q.estimatedOffsetMs);

      if (hasNumericExpected) {
        if (hasNumericEstimated) {
          const errorMs = Math.abs(q.estimatedOffsetMs - q.expectedOffsetMs);
          offsetErrors.push(errorMs);
          if (errorMs <= toleranceMs) {
            withinToleranceOffsets.push(errorMs);
          }
        } else {
          // Missing or null estimated offset is NEVER treated as zero
          offsetUnavailableCount++;
        }
      }
    } else {
      // Server returned a match, but it was the wrong track
      wrongSongIdentifications++;
    }
  }

  // Rate calculations
  const identificationRate = expectedMatches > 0
    ? Number(((correctMatches / expectedMatches) * 100).toFixed(2))
    : 0;

  const missedRate = expectedMatches > 0
    ? Number(((missedExpectedMatches / expectedMatches) * 100).toFixed(2))
    : 0;

  const wrongSongRate = expectedMatches > 0
    ? Number(((wrongSongIdentifications / expectedMatches) * 100).toFixed(2))
    : 0;

  const falsePositiveRate = negativeControls > 0
    ? Number(((negativeControlFalsePositives / negativeControls) * 100).toFixed(2))
    : null; // null if no negative controls in dataset

  const trueNegativeRate = negativeControls > 0
    ? Number(((negativeControlTrueNegatives / negativeControls) * 100).toFixed(2))
    : null;

  // Offset statistics
  const offsetMae = offsetErrors.length > 0
    ? Number((offsetErrors.reduce((acc, v) => acc + v, 0) / offsetErrors.length).toFixed(2))
    : null;

  const offsetWithinToleranceRate = offsetErrors.length > 0
    ? Number(((withinToleranceOffsets.length / offsetErrors.length) * 100).toFixed(2))
    : null;

  // Latency percentiles based only on recorded numeric latencies
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
    const validGroup = group.filter(g => !g.error);
    const groupExpected = validGroup.filter(g => g.expectedTitle && g.expectedTitle.trim().length > 0);
    const groupNegatives = validGroup.filter(g => !g.expectedTitle || g.expectedTitle.trim().length === 0);

    const groupCorrect = groupExpected.filter(g => {
      if (!g.matched || !g.matchedSong) return false;
      return normalizeTrackKey(g.matchedSong.title, g.matchedSong.artist) === normalizeTrackKey(g.expectedTitle, g.expectedArtist);
    });
    const groupMissed = groupExpected.filter(g => !g.matched);
    const groupWrongSong = groupExpected.filter(g => {
      if (!g.matched || !g.matchedSong) return false;
      return normalizeTrackKey(g.matchedSong.title, g.matchedSong.artist) !== normalizeTrackKey(g.expectedTitle, g.expectedArtist);
    });

    const groupOffsets = groupCorrect
      .filter(g => typeof g.expectedOffsetMs === 'number' && typeof g.estimatedOffsetMs === 'number' && !isNaN(g.estimatedOffsetMs))
      .map(g => Math.abs(g.estimatedOffsetMs - g.expectedOffsetMs));

    const groupLatencies = validGroup
      .map(g => g.latencyMs)
      .filter(l => typeof l === 'number' && !isNaN(l));

    breakdownByLabel[lbl] = {
      total: group.length,
      expectedMatches: groupExpected.length,
      correctMatches: groupCorrect.length,
      missedMatches: groupMissed.length,
      wrongSongMatches: groupWrongSong.length,
      negativeControls: groupNegatives.length,
      negativeControlFalsePositives: groupNegatives.filter(g => g.matched).length,
      identificationRatePercent: groupExpected.length > 0
        ? Number(((groupCorrect.length / groupExpected.length) * 100).toFixed(1))
        : 0,
      offsetMaeMs: groupOffsets.length > 0
        ? Number((groupOffsets.reduce((a, b) => a + b, 0) / groupOffsets.length).toFixed(1))
        : null,
      medianLatencyMs: calculatePercentile(groupLatencies.sort((a, b) => a - b), 50)
    };
  }

  return {
    summary: {
      totalExecuted,
      failedRequests,
      expectedMatches,
      correctMatches,
      missedExpectedMatches,
      wrongSongIdentifications,
      identificationRatePercent: identificationRate,
      missedRatePercent: missedRate,
      wrongSongRatePercent: wrongSongRate,
      negativeControls,
      negativeControlTrueNegatives,
      negativeControlFalsePositives,
      falsePositiveRatePercent: falsePositiveRate,
      trueNegativeRatePercent: trueNegativeRate
    },
    offsetAccuracy: {
      evaluatedCount: offsetErrors.length,
      unavailableCount: offsetUnavailableCount,
      toleranceMs,
      withinToleranceCount: withinToleranceOffsets.length,
      withinToleranceRatePercent: offsetWithinToleranceRate,
      meanAbsoluteErrorMs: offsetMae,
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
