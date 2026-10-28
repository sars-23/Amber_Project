package com.amber.openmusic;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class OpenMusicRestartRecoveryTest {

    @Autowired
    private OpenMusicImportRepository repository;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("Healthy active item with future lease is NOT reclaimed during restart recovery")
    void testHealthyActiveItemNotReclaimed() {
        JamendoTrack track = new JamendoTrack("701", "Active Track", "Active Artist", "Album", 180,
                "https://storage.jamendo.com/701.mp3", "https://jamendo.com/track/701",
                "https://creativecommons.org/licenses/by/4.0/", "Attribution");

        UUID jobId = repository.createJob(List.of(track));

        // Worker A claims the track with a 10-minute lease
        Optional<QueuedImportItem> claimed = repository.claimNextPending("worker-A", Duration.ofMinutes(10));
        assertTrue(claimed.isPresent());
        UUID itemId = claimed.get().id();

        // Verify status is PROCESSING and lease is in the future
        String statusBefore = jdbc.queryForObject(
                "SELECT status FROM open_music_import_items WHERE id = ?", String.class, itemId);
        assertEquals("PROCESSING", statusBefore);

        // Instance B restarts and runs recoverStaleProcessing()
        int recovered = repository.recoverStaleProcessing(Duration.ofMinutes(5));
        assertEquals(0, recovered, "Healthy active item must not be recovered");

        // Verify item is STILL PROCESSING and owned by worker-A
        String statusAfter = jdbc.queryForObject(
                "SELECT status FROM open_music_import_items WHERE id = ?", String.class, itemId);
        String lockedByAfter = jdbc.queryForObject(
                "SELECT locked_by FROM open_music_import_items WHERE id = ?", String.class, itemId);
        assertEquals("PROCESSING", statusAfter);
        assertEquals("worker-A", lockedByAfter);

        // Another worker attempting to claim next pending should get nothing
        Optional<QueuedImportItem> claimedAgain = repository.claimNextPending("worker-B", Duration.ofMinutes(5));
        assertTrue(claimedAgain.isEmpty(), "Active item cannot be claimed by another worker");
    }

    @Test
    @DisplayName("Abandoned item with expired lease IS recovered and can be re-processed")
    void testAbandonedItemIsRecovered() {
        JamendoTrack track = new JamendoTrack("702", "Abandoned Track", "Artist", "Album", 200,
                "https://storage.jamendo.com/702.mp3", "https://jamendo.com/track/702",
                "https://creativecommons.org/licenses/by/4.0/", "Attribution");

        UUID jobId = repository.createJob(List.of(track));

        // Claim with worker-crashed
        Optional<QueuedImportItem> claimed = repository.claimNextPending("worker-crashed", Duration.ofMinutes(5));
        assertTrue(claimed.isPresent());
        UUID itemId = claimed.get().id();

        // Simulate that worker crashed and lease expired 10 minutes ago
        Timestamp expiredTimestamp = Timestamp.from(Instant.now().minus(Duration.ofMinutes(10)));
        jdbc.update("UPDATE open_music_import_items SET lease_until = ? WHERE id = ?", expiredTimestamp, itemId);

        // Recovery runs
        int recovered = repository.recoverStaleProcessing(Duration.ofMinutes(5));
        assertEquals(1, recovered, "Expired abandoned item should be recovered");

        // Verify item is reset to PENDING and lock cleared
        String status = jdbc.queryForObject("SELECT status FROM open_music_import_items WHERE id = ?", String.class, itemId);
        String lockedBy = jdbc.queryForObject("SELECT locked_by FROM open_music_import_items WHERE id = ?", String.class, itemId);
        assertEquals("PENDING", status);
        assertNull(lockedBy);

        // Now a healthy worker can claim and process it
        Optional<QueuedImportItem> reclaimed = repository.claimNextPending("worker-healthy", Duration.ofMinutes(5));
        assertTrue(reclaimed.isPresent());
        assertEquals("702", reclaimed.get().externalTrackId());
    }

    @Test
    @DisplayName("Normal claims cannot process the same item twice")
    void testCannotProcessItemTwice() {
        JamendoTrack track = new JamendoTrack("703", "Single Item", "Artist", "Album", 150,
                "https://storage.jamendo.com/703.mp3", "https://jamendo.com/track/703",
                "https://creativecommons.org/licenses/by/4.0/", "Attribution");

        UUID jobId = repository.createJob(List.of(track));

        // First claim succeeds
        Optional<QueuedImportItem> firstClaim = repository.claimNextPending("worker-1", Duration.ofMinutes(5));
        assertTrue(firstClaim.isPresent());

        // Immediate second claim finds no available pending tracks
        Optional<QueuedImportItem> secondClaim = repository.claimNextPending("worker-2", Duration.ofMinutes(5));
        assertTrue(secondClaim.isEmpty(), "Second claim must not return the already claimed track");
    }

    @Test
    @DisplayName("Worker can renew lease to extend lock duration")
    void testLeaseRenewal() {
        JamendoTrack track = new JamendoTrack("704", "Long Track", "Artist", "Album", 300,
                "https://storage.jamendo.com/704.mp3", "https://jamendo.com/track/704",
                "https://creativecommons.org/licenses/by/4.0/", "Attribution");

        UUID jobId = repository.createJob(List.of(track));
        Optional<QueuedImportItem> claimed = repository.claimNextPending("worker-long", Duration.ofMinutes(2));
        assertTrue(claimed.isPresent());
        UUID itemId = claimed.get().id();

        // Renew lease with correct worker
        boolean renewed = repository.renewLease(itemId, "worker-long", Duration.ofMinutes(10));
        assertTrue(renewed);

        // Renew lease with wrong worker should fail
        boolean wrongWorkerRenewed = repository.renewLease(itemId, "worker-intruder", Duration.ofMinutes(10));
        assertFalse(wrongWorkerRenewed);
    }
}
