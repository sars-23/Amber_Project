package com.amber.api.dto;

import com.amber.matching.MatchResult;
import com.amber.matching.OffsetHistogram;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public record MatchResponse(
        boolean matched,
        SongResponse song,
        int estimatedOffsetMs,
        double score,
        double confidence,
        @JsonProperty("matchingHashes") int matchingHashes,
        int totalQueryFingerprints,
        @JsonProperty("searchDurationMs") double searchDurationMs,
        List<OffsetHistogram.HistogramBucket> offsetHistogram,
        String message
) {
    /**
     * Backwards-compatible constructor for existing tests and call sites without message.
     */
    public MatchResponse(
            boolean matched,
            SongResponse song,
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

    @JsonProperty("matchedFingerprints")
    public int matchedFingerprints() {
        return matchingHashes;
    }

    @JsonProperty("processingTimeMs")
    public double processingTimeMs() {
        return searchDurationMs;
    }

    public static MatchResponse from(MatchResult result) {
        return new MatchResponse(
                result.matched(),
                result.matched() && result.song() != null ? SongResponse.from(result.song()) : null,
                result.estimatedOffsetMs(),
                result.score(),
                result.confidence(),
                result.matchingHashes(),
                result.totalQueryFingerprints(),
                result.searchDurationMs(),
                result.offsetHistogram(),
                result.message()
        );
    }
}
