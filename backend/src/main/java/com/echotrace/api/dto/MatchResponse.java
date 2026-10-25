package com.echotrace.api.dto;

import com.echotrace.matching.MatchResult;
import com.echotrace.matching.OffsetHistogram;

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
