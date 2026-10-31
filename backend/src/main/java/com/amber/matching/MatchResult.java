package com.amber.matching;

import com.amber.song.Song;

import java.util.Collections;
import java.util.List;

/**
 * Result of an audio matching search operation.
 */
public record MatchResult(
        boolean matched,
        Song song,
        int estimatedOffsetMs,
        double score,
        double confidence,
        int matchingHashes,
        int totalQueryFingerprints,
        double searchDurationMs,
        List<OffsetHistogram.HistogramBucket> offsetHistogram,
        String message,
        MatchDiagnostics diagnostics
) {
    /**
     * Backwards-compatible constructor for existing tests and call sites without message or diagnostics.
     */
    public MatchResult(
            boolean matched,
            Song song,
            int estimatedOffsetMs,
            double score,
            double confidence,
            int matchingHashes,
            int totalQueryFingerprints,
            double searchDurationMs,
            List<OffsetHistogram.HistogramBucket> offsetHistogram
    ) {
        this(matched, song, estimatedOffsetMs, score, confidence, matchingHashes, totalQueryFingerprints, searchDurationMs, offsetHistogram, null, null);
    }

    /**
     * Backwards-compatible constructor for existing tests and call sites without diagnostics.
     */
    public MatchResult(
            boolean matched,
            Song song,
            int estimatedOffsetMs,
            double score,
            double confidence,
            int matchingHashes,
            int totalQueryFingerprints,
            double searchDurationMs,
            List<OffsetHistogram.HistogramBucket> offsetHistogram,
            String message
    ) {
        this(matched, song, estimatedOffsetMs, score, confidence, matchingHashes, totalQueryFingerprints, searchDurationMs, offsetHistogram, message, null);
    }

    public static MatchResult noMatch(int totalQueryFingerprints, double durationMs) {
        return noMatch(totalQueryFingerprints, durationMs, "No confident match found.");
    }

    public static MatchResult noMatch(int totalQueryFingerprints, double durationMs, String message) {
        MatchDiagnostics diag = MatchDiagnostics.empty(totalQueryFingerprints, durationMs, "NONE_INSUFFICIENT", message);
        return new MatchResult(
                false,
                null,
                0,
                0.0,
                0.0,
                0,
                totalQueryFingerprints,
                durationMs,
                Collections.emptyList(),
                message,
                diag
        );
    }

    public static MatchResult noMatch(int totalQueryFingerprints, double durationMs, String message, MatchDiagnostics diagnostics) {
        return new MatchResult(
                false,
                null,
                0,
                diagnostics != null ? diagnostics.winningScore() : 0.0,
                0.0,
                diagnostics != null ? diagnostics.totalWinningVotes() : 0,
                totalQueryFingerprints,
                durationMs,
                diagnostics != null && diagnostics.topBuckets() != null ? diagnostics.topBuckets() : Collections.emptyList(),
                message,
                diagnostics
        );
    }

    public static MatchResult noMatchWithDiagnostics(
            int totalQueryFingerprints,
            double durationMs,
            double score,
            double confidence,
            int matchingHashes,
            List<OffsetHistogram.HistogramBucket> offsetHistogram,
            String message
    ) {
        MatchDiagnostics diag = new MatchDiagnostics(
                totalQueryFingerprints,
                0,
                0,
                0,
                null,
                score,
                0,
                matchingHashes,
                0.0,
                0.0,
                0.0,
                0,
                "REJECTED",
                message,
                durationMs,
                offsetHistogram != null ? offsetHistogram : Collections.emptyList()
        );
        return new MatchResult(
                false,
                null,
                0,
                score,
                confidence,
                matchingHashes,
                totalQueryFingerprints,
                durationMs,
                offsetHistogram != null ? offsetHistogram : Collections.emptyList(),
                message,
                diag
        );
    }

    public static MatchResult noMatchWithDiagnostics(
            int totalQueryFingerprints,
            double durationMs,
            double score,
            double confidence,
            int matchingHashes,
            List<OffsetHistogram.HistogramBucket> offsetHistogram,
            String message,
            MatchDiagnostics diagnostics
    ) {
        return new MatchResult(
                false,
                null,
                0,
                score,
                confidence,
                matchingHashes,
                totalQueryFingerprints,
                durationMs,
                offsetHistogram != null ? offsetHistogram : Collections.emptyList(),
                message,
                diagnostics
        );
    }
}
