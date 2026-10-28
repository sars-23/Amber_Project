package com.amber.song;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.*;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Repository
public class SongRepository {

    private final JdbcTemplate jdbcTemplate;

    private final RowMapper<Song> songRowMapper = (rs, rowNum) -> new Song(
            rs.getLong("id"),
            rs.getString("title"),
            rs.getString("artist"),
            rs.getLong("duration_ms"),
            rs.getInt("fingerprint_count"),
            toInstant(rs.getTimestamp("created_at"))
    );

    public SongRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static Instant toInstant(Timestamp timestamp) {
        return timestamp != null ? timestamp.toInstant() : Instant.now();
    }

    public Song save(Song song) {
        String sql = "INSERT INTO songs (title, artist, duration_ms, fingerprint_count, created_at) " +
                     "VALUES (?, ?, ?, ?, ?)";

        KeyHolder keyHolder = new GeneratedKeyHolder();
        Timestamp now = Timestamp.from(song.createdAt() != null ? song.createdAt() : Instant.now());

        jdbcTemplate.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(sql, new String[]{"id"});
            ps.setString(1, song.title());
            ps.setString(2, song.artist());
            ps.setLong(3, song.durationMs());
            ps.setInt(4, song.fingerprintCount());
            ps.setTimestamp(5, now);
            return ps;
        }, keyHolder);

        Number key = keyHolder.getKey();
        Long id = key != null ? key.longValue() : null;
        return new Song(id, song.title(), song.artist(), song.durationMs(), song.fingerprintCount(), now.toInstant());
    }

    /** Saves a source track and all license/provenance fields in the same indexing transaction. */
    public Song saveFromSource(Song song, SongSourceMetadata source) {
        String sql = "INSERT INTO songs (title, artist, duration_ms, fingerprint_count, created_at, " +
                "source_provider, source_track_id, source_url, license_url, attribution_text, content_sha256) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        KeyHolder keyHolder = new GeneratedKeyHolder();
        Timestamp now = Timestamp.from(song.createdAt() != null ? song.createdAt() : Instant.now());
        jdbcTemplate.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(sql, new String[]{"id"});
            ps.setString(1, song.title());
            ps.setString(2, song.artist());
            ps.setLong(3, song.durationMs());
            ps.setInt(4, song.fingerprintCount());
            ps.setTimestamp(5, now);
            ps.setString(6, source.sourceProvider());
            ps.setString(7, source.sourceTrackId());
            ps.setString(8, source.sourceUrl());
            ps.setString(9, source.licenseUrl());
            ps.setString(10, source.attributionText());
            ps.setString(11, source.contentSha256());
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        Long id = key != null ? key.longValue() : null;
        return new Song(id, song.title(), song.artist(), song.durationMs(), song.fingerprintCount(), now.toInstant());
    }

    public Optional<Long> findIdBySource(String provider, String externalTrackId) {
        List<Long> results = jdbcTemplate.query(
                "SELECT id FROM songs WHERE source_provider = ? AND source_track_id = ? LIMIT 1",
                (rs, rowNum) -> rs.getLong(1), provider, externalTrackId);
        return results.stream().findFirst();
    }

    public Optional<Long> findIdByContentSha256(String sha256) {
        List<Long> results = jdbcTemplate.query(
                "SELECT id FROM songs WHERE content_sha256 = ? LIMIT 1",
                (rs, rowNum) -> rs.getLong(1), sha256);
        return results.stream().findFirst();
    }

    public void updateFingerprintCount(Long songId, int count) {
        String sql = "UPDATE songs SET fingerprint_count = ? WHERE id = ?";
        jdbcTemplate.update(sql, count, songId);
    }

    public Optional<Song> findById(Long id) {
        String sql = "SELECT id, title, artist, duration_ms, fingerprint_count, created_at FROM songs WHERE id = ?";
        List<Song> results = jdbcTemplate.query(sql, songRowMapper, id);
        return results.stream().findFirst();
    }

    public List<Song> findAll(int offset, int limit) {
        String sql = "SELECT id, title, artist, duration_ms, fingerprint_count, created_at FROM songs " +
                     "ORDER BY created_at DESC LIMIT ? OFFSET ?";
        return jdbcTemplate.query(sql, songRowMapper, limit, offset);
    }

    public boolean deleteById(Long id) {
        String sql = "DELETE FROM songs WHERE id = ?";
        int rows = jdbcTemplate.update(sql, id);
        return rows > 0;
    }

    public long count() {
        String sql = "SELECT COUNT(*) FROM songs";
        Long count = jdbcTemplate.queryForObject(sql, Long.class);
        return count != null ? count : 0L;
    }

    public long getTotalDurationMs() {
        String sql = "SELECT COALESCE(SUM(duration_ms), 0) FROM songs";
        Long total = jdbcTemplate.queryForObject(sql, Long.class);
        return total != null ? total : 0L;
    }
}
