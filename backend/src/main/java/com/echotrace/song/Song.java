package com.echotrace.song;

import java.time.Instant;

/**
 * Domain representation of an indexed audio track.
 */
public record Song(
        Long id,
        String title,
        String artist,
        long durationMs,
        int fingerprintCount,
        Instant createdAt
) {
    public Song(String title, String artist, long durationMs) {
        this(null, title, artist, durationMs, 0, Instant.now());
    }

    public Song withIdAndCounts(Long id, int fingerprintCount, Instant createdAt) {
        return new Song(id, this.title, this.artist, this.durationMs, fingerprintCount, createdAt);
    }
}
