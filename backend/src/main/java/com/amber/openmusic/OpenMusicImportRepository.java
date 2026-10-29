package com.amber.openmusic;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class OpenMusicImportRepository {
    private final JdbcTemplate jdbc;

    private final String instanceId = "worker-" + UUID.randomUUID();
    public static final Duration DEFAULT_LEASE_DURATION = Duration.ofMinutes(5);

    public OpenMusicImportRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public String getInstanceId() {
        return instanceId;
    }

    @Transactional
    public UUID createJob(List<JamendoTrack> tracks) {
        UUID jobId = UUID.randomUUID();
        jdbc.update("INSERT INTO open_music_import_jobs (id, status, requested_count) VALUES (?, 'QUEUED', ?)",
                jobId, tracks.size());
        for (JamendoTrack track : tracks) {
            jdbc.update("""
                    INSERT INTO open_music_import_items
                    (id, job_id, provider, external_track_id, title, artist, album_name, duration_seconds,
                     source_url, license_url, attribution_text, status)
                    VALUES (?, ?, 'jamendo', ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
                    """,
                    UUID.randomUUID(), jobId, track.id(), track.title(), track.artist(), track.album(),
                    track.durationSeconds(), track.sourceUrl(), track.licenseUrl(), track.attributionText());
        }
        return jobId;
    }

    @Transactional
    public Optional<QueuedImportItem> claimNextPending(String workerId, Duration leaseDuration) {
        String selectSql = """
                SELECT i.id, i.job_id, i.external_track_id, i.title, i.artist,
                       i.source_url, i.license_url, i.attribution_text
                FROM open_music_import_items i
                JOIN open_music_import_jobs j ON j.id = i.job_id
                WHERE (i.status = 'PENDING' OR (i.status = 'PROCESSING' AND i.lease_until IS NOT NULL AND i.lease_until < CURRENT_TIMESTAMP))
                  AND j.status IN ('QUEUED', 'RUNNING')
                ORDER BY i.created_at, i.id
                LIMIT 1
                FOR UPDATE
                """;
        List<QueuedImportItem> items = jdbc.query(selectSql, (rs, rowNum) -> new QueuedImportItem(
                rs.getObject("id", UUID.class), rs.getObject("job_id", UUID.class),
                rs.getString("external_track_id"), rs.getString("title"), rs.getString("artist"),
                rs.getString("source_url"), rs.getString("license_url"),
                rs.getString("attribution_text")));
        if (items.isEmpty()) return Optional.empty();
        QueuedImportItem item = items.get(0);

        Timestamp leaseUntil = Timestamp.from(Instant.now().plus(leaseDuration));
        int updated = jdbc.update("""
                UPDATE open_music_import_items
                SET status = 'PROCESSING',
                    attempts = attempts + 1,
                    lease_until = ?,
                    locked_by = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND (status = 'PENDING' OR (status = 'PROCESSING' AND lease_until IS NOT NULL AND lease_until < CURRENT_TIMESTAMP))
                """, leaseUntil, workerId, item.id());

        if (updated == 0) {
            // Concurrent worker claimed this item first
            return Optional.empty();
        }

        jdbc.update("UPDATE open_music_import_jobs SET status = 'RUNNING', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'QUEUED'",
                item.jobId());
        return Optional.of(item);
    }

    @Transactional
    public Optional<QueuedImportItem> claimNextPending() {
        return claimNextPending(instanceId, DEFAULT_LEASE_DURATION);
    }

    @Transactional
    public boolean renewLease(UUID itemId, String workerId, Duration leaseDuration) {
        Timestamp newLease = Timestamp.from(Instant.now().plus(leaseDuration));
        int updated = jdbc.update("""
                UPDATE open_music_import_items
                SET lease_until = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'PROCESSING' AND locked_by = ?
                """, newLease, itemId, workerId);
        return updated > 0;
    }

    @Transactional
    public boolean markItem(UUID itemId, String workerId, String status, String error, Long songId, Long downloadedBytes, String sha256) {
        String safeError = error;
        if (safeError != null && safeError.length() > 590) safeError = safeError.substring(0, 590);
        int updated = jdbc.update("""
                UPDATE open_music_import_items
                SET status = ?, error_message = ?, song_id = COALESCE(?, song_id),
                    downloaded_bytes = COALESCE(?, downloaded_bytes),
                    content_sha256 = COALESCE(?, content_sha256),
                    lease_until = NULL,
                    locked_by = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND locked_by = ?
                """, status, safeError, songId, downloadedBytes, sha256, itemId, workerId);
        return updated > 0;
    }

    @Transactional
    public void markItem(UUID itemId, String status, String error, Long songId, Long downloadedBytes, String sha256) {
        String safeError = error;
        if (safeError != null && safeError.length() > 590) safeError = safeError.substring(0, 590);
        jdbc.update("""
                UPDATE open_music_import_items
                SET status = ?, error_message = ?, song_id = COALESCE(?, song_id),
                    downloaded_bytes = COALESCE(?, downloaded_bytes),
                    content_sha256 = COALESCE(?, content_sha256),
                    lease_until = NULL,
                    locked_by = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """, status, safeError, songId, downloadedBytes, sha256, itemId);
    }

    public record ItemLeaseInfo(String status, String lockedBy, Instant leaseUntil) {}

    public Optional<ItemLeaseInfo> getItemLeaseInfo(UUID itemId) {
        List<ItemLeaseInfo> list = jdbc.query("""
                SELECT status, locked_by, lease_until FROM open_music_import_items WHERE id = ?
                """, (rs, rowNum) -> new ItemLeaseInfo(
                rs.getString("status"),
                rs.getString("locked_by"),
                instant(rs.getTimestamp("lease_until"))
        ), itemId);
        return list.isEmpty() ? Optional.empty() : Optional.of(list.get(0));
    }

    public void refreshJobStatus(UUID jobId) {
        List<String> current = jdbc.query("SELECT status FROM open_music_import_jobs WHERE id = ?",
                (rs, rowNum) -> rs.getString(1), jobId);
        if (current.isEmpty()) return;
        String currentStatus = current.get(0);
        if (List.of("COMPLETED", "COMPLETED_WITH_ERRORS", "CANCELLED").contains(currentStatus)) return;
        int[] counts = jdbc.query("""
                SELECT
                    COUNT(*) FILTER (WHERE status = 'PENDING') AS pending_count,
                    COUNT(*) FILTER (WHERE status = 'PROCESSING') AS processing_count,
                    COUNT(*) FILTER (WHERE status = 'FAILED') AS failed_count
                FROM open_music_import_items WHERE job_id = ?
                """, rs -> {
            if (!rs.next()) return new int[]{0, 0, 0};
            return new int[]{rs.getInt("pending_count"), rs.getInt("processing_count"), rs.getInt("failed_count")};
        }, jobId);
        int pending = counts[0], processing = counts[1], failed = counts[2];
        String nextStatus;
        if ("CANCEL_REQUESTED".equals(currentStatus)) {
            nextStatus = processing > 0 ? "CANCEL_REQUESTED" : "CANCELLED";
        } else if (pending + processing > 0) {
            nextStatus = processing > 0 ? "RUNNING" : "QUEUED";
        } else {
            nextStatus = failed > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
        }
        boolean terminal = List.of("COMPLETED", "COMPLETED_WITH_ERRORS", "CANCELLED").contains(nextStatus);
        jdbc.update("""
                UPDATE open_music_import_jobs
                SET status = ?, updated_at = CURRENT_TIMESTAMP,
                    completed_at = CASE WHEN ? THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE NULL END
                WHERE id = ?
                """, nextStatus, terminal, jobId);
    }

    public Optional<OpenMusicImportJobView> findJob(UUID jobId) {
        List<JobHeader> headers = jdbc.query("""
                SELECT id, status, requested_count, created_at, updated_at, completed_at
                FROM open_music_import_jobs WHERE id = ?
                """, (rs, rowNum) -> new JobHeader(rs.getObject("id", UUID.class), rs.getString("status"),
                rs.getInt("requested_count"), instant(rs.getTimestamp("created_at")),
                instant(rs.getTimestamp("updated_at")), instant(rs.getTimestamp("completed_at"))), jobId);
        if (headers.isEmpty()) return Optional.empty();
        JobHeader header = headers.get(0);
        int[] counts = jdbc.query("""
                SELECT
                    COUNT(*) FILTER (WHERE status = 'PENDING') AS queued_count,
                    COUNT(*) FILTER (WHERE status = 'PROCESSING') AS processing_count,
                    COUNT(*) FILTER (WHERE status = 'IMPORTED') AS imported_count,
                    COUNT(*) FILTER (WHERE status = 'SKIPPED') AS skipped_count,
                    COUNT(*) FILTER (WHERE status = 'FAILED') AS failed_count,
                    COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled_count
                FROM open_music_import_items WHERE job_id = ?
                """, rs -> {
            if (!rs.next()) return new int[6];
            return new int[]{rs.getInt("queued_count"), rs.getInt("processing_count"), rs.getInt("imported_count"),
                    rs.getInt("skipped_count"), rs.getInt("failed_count"), rs.getInt("cancelled_count")};
        }, jobId);
        List<OpenMusicImportItemView> items = jdbc.query("""
                SELECT id, provider, external_track_id, title, artist, album_name, duration_seconds,
                       source_url, license_url, attribution_text, status, attempts, error_message,
                       downloaded_bytes, content_sha256, song_id, created_at, updated_at
                FROM open_music_import_items WHERE job_id = ? ORDER BY created_at, id
                """, ITEM_VIEW_MAPPER, jobId);
        return Optional.of(new OpenMusicImportJobView(header.id(), header.status(), header.requestedCount(),
                counts[0], counts[1], counts[2], counts[3], counts[4], counts[5],
                header.createdAt(), header.updatedAt(), header.completedAt(), items));
    }

    public List<OpenMusicImportJobView> findActiveJobs() {
        List<UUID> ids = jdbc.query("""
                SELECT id FROM open_music_import_jobs
                WHERE status IN ('QUEUED', 'RUNNING', 'CANCEL_REQUESTED')
                ORDER BY updated_at DESC LIMIT 10
                """, (rs, rowNum) -> rs.getObject("id", UUID.class));
        List<OpenMusicImportJobView> jobs = new ArrayList<>();
        for (UUID id : ids) findJob(id).ifPresent(jobs::add);
        return jobs;
    }

    @Transactional
    public int retryFailed(UUID jobId) {
        int updated = jdbc.update("""
                UPDATE open_music_import_items SET status = 'PENDING', error_message = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE job_id = ? AND status = 'FAILED'
                """, jobId);
        if (updated > 0) {
            jdbc.update("""
                    UPDATE open_music_import_jobs SET status = 'QUEUED', completed_at = NULL,
                        updated_at = CURRENT_TIMESTAMP WHERE id = ?
                    """, jobId);
        }
        return updated;
    }

    @Transactional
    public boolean requestCancel(UUID jobId) {
        List<String> statuses = jdbc.query("SELECT status FROM open_music_import_jobs WHERE id = ?",
                (rs, rowNum) -> rs.getString(1), jobId);
        if (statuses.isEmpty() || List.of("COMPLETED", "COMPLETED_WITH_ERRORS", "CANCELLED").contains(statuses.get(0))) {
            return false;
        }
        jdbc.update("UPDATE open_music_import_items SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE job_id = ? AND status = 'PENDING'", jobId);
        Integer processing = jdbc.queryForObject("SELECT COUNT(*) FROM open_music_import_items WHERE job_id = ? AND status = 'PROCESSING'", Integer.class, jobId);
        String newStatus = processing != null && processing > 0 ? "CANCEL_REQUESTED" : "CANCELLED";
        jdbc.update("UPDATE open_music_import_jobs SET status = ?, completed_at = CASE WHEN ? = 'CANCELLED' THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                newStatus, newStatus, jobId);
        return true;
    }

    @Transactional
    public int recoverStaleProcessing(Duration staleTimeout) {
        Timestamp staleThreshold = Timestamp.from(Instant.now().minus(staleTimeout));

        List<UUID> affectedJobs = jdbc.query("""
                SELECT DISTINCT job_id FROM open_music_import_items
                WHERE status = 'PROCESSING'
                  AND (
                      (lease_until IS NOT NULL AND lease_until < CURRENT_TIMESTAMP)
                      OR (lease_until IS NULL AND updated_at < ?)
                  )
                """, (rs, rowNum) -> rs.getObject("job_id", UUID.class), staleThreshold);

        int recoveredItems = jdbc.update("""
                UPDATE open_music_import_items
                SET status = CASE
                        WHEN (SELECT j.status FROM open_music_import_jobs j WHERE j.id = open_music_import_items.job_id) = 'CANCEL_REQUESTED'
                        THEN 'CANCELLED'
                        ELSE 'PENDING'
                    END,
                    lease_until = NULL,
                    locked_by = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE status = 'PROCESSING'
                  AND (
                      (lease_until IS NOT NULL AND lease_until < CURRENT_TIMESTAMP)
                      OR (lease_until IS NULL AND updated_at < ?)
                  )
                """, staleThreshold);

        for (UUID jobId : affectedJobs) {
            refreshJobStatus(jobId);
        }
        return recoveredItems;
    }

    @Transactional
    public int recoverStaleProcessing() {
        return recoverStaleProcessing(Duration.ofMinutes(5));
    }

    @Transactional
    public void recoverInterruptedJobs() {
        recoverStaleProcessing(Duration.ofMinutes(5));
    }

    private static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    private record JobHeader(UUID id, String status, int requestedCount, Instant createdAt,
                             Instant updatedAt, Instant completedAt) {}

    private static final RowMapper<OpenMusicImportItemView> ITEM_VIEW_MAPPER = (rs, rowNum) -> {
        long rawSongId = rs.getLong("song_id");
        Long songId = rs.wasNull() ? null : rawSongId;
        long rawBytes = rs.getLong("downloaded_bytes");
        Long bytes = rs.wasNull() ? null : rawBytes;
        return new OpenMusicImportItemView(rs.getObject("id", UUID.class), rs.getString("provider"),
                rs.getString("external_track_id"), rs.getString("title"), rs.getString("artist"),
                rs.getString("album_name"), rs.getInt("duration_seconds"), rs.getString("source_url"),
                rs.getString("license_url"), rs.getString("attribution_text"), rs.getString("status"),
                rs.getInt("attempts"), rs.getString("error_message"), bytes, rs.getString("content_sha256"),
                songId, instant(rs.getTimestamp("created_at")), instant(rs.getTimestamp("updated_at")));
    };
}
