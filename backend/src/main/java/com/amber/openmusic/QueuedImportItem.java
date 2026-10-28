package com.amber.openmusic;

import java.util.UUID;

record QueuedImportItem(
        UUID id,
        UUID jobId,
        String externalTrackId,
        String title,
        String artist,
        String downloadUrl,
        String sourceUrl,
        String licenseUrl,
        String attributionText
) {}
