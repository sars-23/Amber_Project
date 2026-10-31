package com.amber.matching;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Collections;
import java.util.List;

/**
 * Detailed diagnostic information for audio matching evaluation.
 * Exposes internal metrics without exposing administrative secrets or raw audio.
 */
public record MatchDiagnostics(
        @JsonProperty("queryFingerprints") int queryFingerprints,
        @JsonProperty("distinctQueryHashes") int distinctQueryHashes,
        @JsonProperty("candidateFingerprintRows") int candidateFingerprintRows,
        @JsonProperty("candidateSongs") int candidateSongs,
        @JsonProperty("winningSongId") Long winningSongId,
        @JsonProperty("winningScore") double winningScore,
        @JsonProperty("winningPeakVotes") int winningPeakVotes,
        @JsonProperty("totalWinningVotes") int totalWinningVotes,
        @JsonProperty("coherenceRatio") double coherenceRatio,
        @JsonProperty("runnerUpScore") double runnerUpScore,
        @JsonProperty("margin") double margin,
        @JsonProperty("estimatedOffsetMs") int estimatedOffsetMs,
        @JsonProperty("rejectionGate") String rejectionGate,
        @JsonProperty("rejectionReason") String rejectionReason,
        @JsonProperty("searchDurationMs") double searchDurationMs,
        @JsonProperty("topBuckets") List<OffsetHistogram.HistogramBucket> topBuckets
) {
    public static MatchDiagnostics empty(int queryFingerprints, double durationMs, String rejectionGate, String rejectionReason) {
        return new MatchDiagnostics(
                queryFingerprints,
                0,
                0,
                0,
                null,
                0.0,
                0,
                0,
                0.0,
                0.0,
                0.0,
                0,
                rejectionGate,
                rejectionReason,
                durationMs,
                Collections.emptyList()
        );
    }
}
