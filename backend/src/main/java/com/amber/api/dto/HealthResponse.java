package com.amber.api.dto;

public record HealthResponse(
        String status,
        String version,
        String database,
        int sampleRate,
        int fftSize,
        int hopSize
) {
}
