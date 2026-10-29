package com.amber.song;

/** Provenance retained for audio imported from an external catalog. */
public record SongSourceMetadata(
        String sourceProvider,
        String sourceTrackId,
        String sourceUrl,
        String licenseUrl,
        String attributionText,
        String contentSha256
) {}
