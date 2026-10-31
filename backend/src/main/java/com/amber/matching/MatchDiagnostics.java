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
        @JsonProperty("winningSongTitle") String winningSongTitle,
        @JsonProperty("winningSongArtist") String winningSongArtist,
        @JsonProperty("winningScore") double winningScore,
        @JsonProperty("winningPeakVotes") int winningPeakVotes,
        @JsonProperty("totalWinningVotes") int totalWinningVotes,
        @JsonProperty("rawPairwiseVotes") int rawPairwiseVotes,
        @JsonProperty("coherenceRatio") double coherenceRatio,
        @JsonProperty("runnerUpScore") double runnerUpScore,
        @JsonProperty("margin") double margin,
        @JsonProperty("estimatedOffsetMs") int estimatedOffsetMs,
        @JsonProperty("rejectionGate") String rejectionGate,
        @JsonProperty("rejectionReason") String rejectionReason,
        @JsonProperty("searchDurationMs") double searchDurationMs,
        @JsonProperty("topBuckets") List<OffsetHistogram.HistogramBucket> topBuckets
) {
    /**
     * Backwards-compatible constructor for existing tests and call sites without title, artist, or rawPairwiseVotes.
     */
    public MatchDiagnostics(
            int queryFingerprints,
            int distinctQueryHashes,
            int candidateFingerprintRows,
            int candidateSongs,
            Long winningSongId,
            double winningScore,
            int winningPeakVotes,
            int totalWinningVotes,
            double coherenceRatio,
            double runnerUpScore,
            double margin,
            int estimatedOffsetMs,
            String rejectionGate,
            String rejectionReason,
            double searchDurationMs,
            List<OffsetHistogram.HistogramBucket> topBuckets
    ) {
        this(
                queryFingerprints,
                distinctQueryHashes,
                candidateFingerprintRows,
                candidateSongs,
                winningSongId,
                null,
                null,
                winningScore,
                winningPeakVotes,
                totalWinningVotes,
                totalWinningVotes,
                coherenceRatio,
                runnerUpScore,
                margin,
                estimatedOffsetMs,
                rejectionGate,
                rejectionReason,
                searchDurationMs,
                topBuckets
        );
    }

    public static MatchDiagnostics empty(int queryFingerprints, double durationMs, String rejectionGate, String rejectionReason) {
        return new MatchDiagnostics(
                queryFingerprints,
                0,
                0,
                0,
                null,
                null,
                null,
                0.0,
                0,
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
