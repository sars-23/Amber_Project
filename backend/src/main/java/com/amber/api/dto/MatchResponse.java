package com.amber.api.dto;

import com.amber.matching.MatchResult;
import com.amber.matching.OffsetHistogram;

import java.util.List;

public record MatchResponse(
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
    public static MatchResponse from(MatchResult result) {
        return new MatchResponse(
                result.matched(),
                result.song() != null ? SongResponse.from(result.song()) : null,
                result.estimatedOffsetMs(),
                result.score(),
                result.confidence(),
                result.matchingHashes(),
                result.totalQueryFingerprints(),
                result.searchDurationMs(),
                result.offsetHistogram()
        );
    }
}
