package com.amber.openmusic;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record OpenMusicImportJobView(
        UUID id,
        String status,
        int total,
        int queued,
        int processing,
        int imported,
        int skipped,
        int failed,
        int cancelled,
        Instant createdAt,
        Instant updatedAt,
        Instant completedAt,
        List<OpenMusicImportItemView> items
) {}
