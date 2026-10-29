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
        String message
) {
    /**
     * Backwards-compatible constructor for existing tests and call sites without message.
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
        this(matched, song, estimatedOffsetMs, score, confidence, matchingHashes, totalQueryFingerprints, searchDurationMs, offsetHistogram, null);
    }

    public static MatchResult noMatch(int totalQueryFingerprints, double durationMs) {
        return noMatch(totalQueryFingerprints, durationMs, "No confident match found.");
    }

    public static MatchResult noMatch(int totalQueryFingerprints, double durationMs, String message) {
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
                message
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
                message
        );
    }
}
