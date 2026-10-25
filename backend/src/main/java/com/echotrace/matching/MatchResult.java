package com.echotrace.matching;

import com.echotrace.song.Song;

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
        List<OffsetHistogram.HistogramBucket> offsetHistogram
) {
    public static MatchResult noMatch(int totalQueryFingerprints, double durationMs) {
        return new MatchResult(
                false,
                null,
                0,
                0.0,
                0.0,
                0,
                totalQueryFingerprints,
                durationMs,
                Collections.emptyList()
        );
    }
}
