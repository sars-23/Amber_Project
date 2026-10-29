package com.amber.openmusic;

/** Internal, server-verified Jamendo metadata. downloadUrl is never returned to the browser. */
public record JamendoTrack(
        String id,
        String title,
        String artist,
        String album,
        int durationSeconds,
        String downloadUrl,
        String sourceUrl,
        String licenseUrl,
        String attributionText
) {}
