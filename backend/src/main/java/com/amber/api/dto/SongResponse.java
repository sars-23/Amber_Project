package com.amber.api.dto;

import com.amber.song.Song;
import java.time.Instant;

public record SongResponse(
        Long id,
        String title,
        String artist,
        long durationMs,
        int fingerprintCount,
        Instant createdAt
) {
    public static SongResponse from(Song song) {
        return new SongResponse(
                song.id(),
                song.title(),
                song.artist(),
                song.durationMs(),
                song.fingerprintCount(),
                song.createdAt()
        );
    }
}
