package com.amber.api.dto;

public record StatsResponse(
        long totalSongs,
        long totalFingerprints,
        long totalDurationMs,
        long totalSearches,
        double averageSearchLatencyMs
) {
}
