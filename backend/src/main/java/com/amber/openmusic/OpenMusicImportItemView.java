package com.amber.openmusic;

import java.time.Instant;
import java.util.UUID;

public record OpenMusicImportItemView(
        UUID id,
        String provider,
        String externalTrackId,
        String title,
        String artist,
        String album,
        int durationSeconds,
        String sourceUrl,
        String licenseUrl,
        String attributionText,
        String status,
        int attempts,
        String errorMessage,
        Long downloadedBytes,
        String contentSha256,
        Long songId,
        Instant createdAt,
        Instant updatedAt
) {}
