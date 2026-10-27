package com.amber.benchmark.dto;

import com.amber.matching.OffsetHistogram;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public record BenchmarkResponse(
        boolean matched,
        String referenceTitle,
        double snrDb,
        int targetOffsetMs,
        int estimatedOffsetMs,
        int offsetErrorMs,
        double score,
        double confidence,
        @JsonProperty("matchingHashes") int matchingHashes,
        int totalQueryFingerprints,
        int totalReferenceFingerprints,
        @JsonProperty("searchDurationMs") double searchDurationMs,
        List<OffsetHistogram.HistogramBucket> offsetHistogram,
        String explanation
) {
    @JsonProperty("matchedFingerprints")
    public int matchedFingerprints() {
        return matchingHashes;
    }

    @JsonProperty("processingTimeMs")
    public double processingTimeMs() {
        return searchDurationMs;
    }
}
