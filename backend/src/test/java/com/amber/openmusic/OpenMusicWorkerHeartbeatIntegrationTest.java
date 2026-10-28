package com.amber.openmusic;

import com.amber.indexing.SongIndexingService;
import com.amber.song.Song;
import com.amber.song.SongRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class OpenMusicWorkerHeartbeatIntegrationTest {

    @Autowired
    private OpenMusicImportRepository repository;

    @Autowired
    private SongRepository songRepository;

    @Autowired
    private SongIndexingService indexingService;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("Heartbeat continuously extends lease during long processing; another worker cannot claim item")
    void testHeartbeatExtendsLeaseDuringLongProcessing() throws Exception {
        JamendoTrack track = new JamendoTrack("801", "Long Process Track", "Artist", "Album", 180,
                "https://storage.jamendo.com/801.mp3", "https://jamendo.com/track/801",
                "https://creativecommons.org/licenses/by/4.0/", "Attribution");

        UUID jobId = repository.createJob(List.of(track));

        // Mock JamendoClient so fetchPermittedTrack simulates long processing (300 ms)
        JamendoClient mockClient = Mockito.mock(JamendoClient.class);
        when(mockClient.fetchPermittedTrack("801")).thenAnswer(invocation -> {
            // Processing takes 300ms, while lease is only 150ms!
            // Without heartbeat, the lease would expire at 150ms and be stealable at 200ms.
            Thread.sleep(300);
            return Optional.of(track);
        });

        // Worker A with fast heartbeat (40ms interval, 150ms lease extension)
        OpenMusicImportWorker workerA = new OpenMusicImportWorker(
                repository, songRepository, indexingService, mockClient,
                Duration.ofMillis(40), Duration.ofMillis(150)
        );

        String workerAId = repository.getInstanceId();
        Optional<QueuedImportItem> claimed = repository.claimNextPending(workerAId, Duration.ofMillis(150));
        assertTrue(claimed.isPresent());
        QueuedImportItem item = claimed.get();

        // Run worker A processing on a background thread
        CountDownLatch processingStarted = new CountDownLatch(1);
        CountDownLatch processingFinished = new CountDownLatch(1);
        AtomicReference<Exception> workerError = new AtomicReference<>();

        Thread processingThread = new Thread(() -> {
            processingStarted.countDown();
            try {
                workerA.processClaimedItem(item, workerAId);
            } catch (Exception ex) {
                workerError.set(ex);
            } finally {
                processingFinished.countDown();
            }
        });
        processingThread.start();
        assertTrue(processingStarted.await(1, TimeUnit.SECONDS));

        // Wait 220 ms (longer than the initial 150ms lease)
        Thread.sleep(220);

        // At 220 ms, Worker B attempts to claim the track or recover stale items
        Optional<QueuedImportItem> claimByB = repository.claimNextPending("worker-B", Duration.ofMinutes(1));
        assertTrue(claimByB.isEmpty(), "Worker B must NOT be able to claim the track while Worker A's heartbeat extends lease");

        int recovered = repository.recoverStaleProcessing(Duration.ofMillis(50));
        assertEquals(0, recovered, "Startup/stale recovery must NOT reclaim active item with active heartbeat");

        // Wait for processing thread to finish
        assertTrue(processingFinished.await(3, TimeUnit.SECONDS));
        workerA.shutdown();

        // Item was either imported or handled gracefully without throwing unhandled exceptions
        assertNull(workerError.get());
    }

    @Test
    @DisplayName("Worker detects loss of ownership on heartbeat renewal and aborts without overwriting new owner state")
    void testWorkerAbortsWhenOwnershipLost() throws Exception {
        JamendoTrack track = new JamendoTrack("802", "Stolen Track", "Artist", "Album", 180,
                "https://storage.jamendo.com/802.mp3", "https://jamendo.com/track/802",
                "https://creativecommons.org/licenses/by/4.0/", "Attribution");

        UUID jobId = repository.createJob(List.of(track));

        CountDownLatch trackFetchStarted = new CountDownLatch(1);
        CountDownLatch releaseHold = new CountDownLatch(1);

        JamendoClient mockClient = Mockito.mock(JamendoClient.class);
        when(mockClient.fetchPermittedTrack("802")).thenAnswer(invocation -> {
            trackFetchStarted.countDown();
            // Block until test steals the lock
            releaseHold.await(2, TimeUnit.SECONDS);
            return Optional.of(track);
        });

        // Worker A with fast heartbeat (30ms interval, 100ms lease)
        OpenMusicImportWorker workerA = new OpenMusicImportWorker(
                repository, songRepository, indexingService, mockClient,
                Duration.ofMillis(30), Duration.ofMillis(100)
        );

        String workerAId = "worker-A-original";
        Optional<QueuedImportItem> claimed = repository.claimNextPending(workerAId, Duration.ofMillis(100));
        assertTrue(claimed.isPresent());
        QueuedImportItem item = claimed.get();

        CountDownLatch workerFinished = new CountDownLatch(1);
        Thread workerThread = new Thread(() -> {
            try {
                workerA.processClaimedItem(item, workerAId);
            } finally {
                workerFinished.countDown();
            }
        });
        workerThread.start();

        // Wait until worker enters fetchPermittedTrack
        assertTrue(trackFetchStarted.await(1, TimeUnit.SECONDS));

        // Simulate ownership loss: Another instance (worker-C) acquires ownership
        jdbc.update("UPDATE open_music_import_items SET locked_by = 'worker-C', lease_until = ? WHERE id = ?",
                java.sql.Timestamp.from(Instant.now().plus(Duration.ofMinutes(10))), item.id());

        // Release the hold in mockClient so worker A attempts to proceed
        releaseHold.countDown();

        // Worker A should detect loss of ownership, get interrupted, and terminate safely
        assertTrue(workerFinished.await(3, TimeUnit.SECONDS));
        workerA.shutdown();

        // Verify that worker-A DID NOT overwrite worker-C's locked_by status!
        String currentOwner = jdbc.queryForObject(
                "SELECT locked_by FROM open_music_import_items WHERE id = ?", String.class, item.id());
        assertEquals("worker-C", currentOwner, "Worker A must NOT overwrite worker C's ownership");
    }

    @Test
    @DisplayName("Heartbeat database exception treats ownership as unverified, aborts safely, and allows lease to expire naturally")
    void testTransientHeartbeatDatabaseExceptionAbortsSafelyAndLeavesLeaseToExpireNaturally() throws Exception {
        JamendoTrack track = new JamendoTrack("803", "DB Failure Track", "Artist", "Album", 180,
                "https://storage.jamendo.com/803.mp3", "https://jamendo.com/track/803",
                "https://creativecommons.org/licenses/by/4.0/", "Attribution");

        UUID jobId = repository.createJob(List.of(track));

        CountDownLatch trackFetchStarted = new CountDownLatch(1);
        CountDownLatch finishTask = new CountDownLatch(1);

        JamendoClient mockClient = Mockito.mock(JamendoClient.class);
        when(mockClient.fetchPermittedTrack("803")).thenAnswer(invocation -> {
            trackFetchStarted.countDown();
            finishTask.await(2, TimeUnit.SECONDS);
            return Optional.of(track);
        });

        // Subclass repository so renewLease throws a transient database exception on heartbeat
        OpenMusicImportRepository failingRepo = new OpenMusicImportRepository(jdbc) {
            @Override
            public boolean renewLease(UUID itemId, String workerId, Duration leaseDuration) {
                throw new org.springframework.dao.DataAccessResourceFailureException("Simulated transient connection failure");
            }
        };

        OpenMusicImportWorker workerA = new OpenMusicImportWorker(
                failingRepo, songRepository, indexingService, mockClient,
                Duration.ofMillis(30), Duration.ofMillis(100)
        );

        String workerAId = "worker-A-db-err";
        Optional<QueuedImportItem> claimed = repository.claimNextPending(workerAId, Duration.ofMillis(200));
        assertTrue(claimed.isPresent());
        QueuedImportItem item = claimed.get();

        CountDownLatch workerFinished = new CountDownLatch(1);
        AtomicReference<Exception> workerError = new AtomicReference<>();
        Thread workerThread = new Thread(() -> {
            try {
                workerA.processClaimedItem(item, workerAId);
            } catch (Exception ex) {
                workerError.set(ex);
            } finally {
                workerFinished.countDown();
            }
        });
        workerThread.start();

        // Wait until worker enters task
        assertTrue(trackFetchStarted.await(1, TimeUnit.SECONDS));

        // Allow worker to proceed after heartbeat throws DB exception
        Thread.sleep(60); // let heartbeat tick and trigger the DB exception
        finishTask.countDown();

        assertTrue(workerFinished.await(3, TimeUnit.SECONDS));
        workerA.shutdown();

        // The item must NOT be marked FAILED! It should remain in PROCESSING status
        String status = jdbc.queryForObject(
                "SELECT status FROM open_music_import_items WHERE id = ?", String.class, item.id());
        assertEquals("PROCESSING", status, "Item must remain in PROCESSING, not marked FAILED");

        // The job status must NOT be transitioned to COMPLETED_WITH_ERRORS or CANCELLED
        String jobStatus = jdbc.queryForObject(
                "SELECT status FROM open_music_import_jobs WHERE id = ?", String.class, jobId);
        assertEquals("RUNNING", jobStatus);

        // Now simulate the passage of time so the lease expires naturally
        jdbc.update("UPDATE open_music_import_items SET lease_until = ? WHERE id = ?",
                java.sql.Timestamp.from(Instant.now().minus(Duration.ofMinutes(1))), item.id());

        // Stale recovery safely reclaims the abandoned item back to PENDING
        int recovered = repository.recoverStaleProcessing(Duration.ofMillis(10));
        assertEquals(1, recovered, "Expired abandoned item must be recovered by stale recovery");

        String statusRecovered = jdbc.queryForObject(
                "SELECT status FROM open_music_import_items WHERE id = ?", String.class, item.id());
        assertEquals("PENDING", statusRecovered, "Item should be recovered to PENDING");
    }

    @Test
    @DisplayName("Reconciliation prevents duplicate catalogue entries when retrying after aborted processing")
    void testReconciliationPreventsDuplicateOnRetryAfterHeartbeatFailure() {
        // Pre-index the song in Amber catalogue to simulate an earlier partial or duplicate index
        com.amber.song.SongSourceMetadata provenance = new com.amber.song.SongSourceMetadata(
                "jamendo", "804", "https://jamendo.com/track/804",
                "https://creativecommons.org/licenses/by/4.0/", "Attribution 804", "fakehash804");
        Song savedSong = songRepository.saveFromSource(new Song("Duplicate Track", "Artist", 120000), provenance);
        assertNotNull(savedSong.id());

        JamendoTrack track = new JamendoTrack("804", "Duplicate Track", "Artist", "Album", 120,
                "https://storage.jamendo.com/804.mp3", "https://jamendo.com/track/804",
                "https://creativecommons.org/licenses/by/4.0/", "Attribution 804");

        UUID jobId = repository.createJob(List.of(track));
        String workerId = repository.getInstanceId();
        Optional<QueuedImportItem> claimed = repository.claimNextPending(workerId, Duration.ofMinutes(1));
        assertTrue(claimed.isPresent());

        JamendoClient mockClient = Mockito.mock(JamendoClient.class);
        OpenMusicImportWorker worker = new OpenMusicImportWorker(
                repository, songRepository, indexingService, mockClient,
                Duration.ofSeconds(10), Duration.ofMinutes(1)
        );

        // Processing should detect already indexed source track and mark SKIPPED without creating duplicates
        worker.processClaimedItem(claimed.get(), workerId);
        worker.shutdown();

        String itemStatus = jdbc.queryForObject(
                "SELECT status FROM open_music_import_items WHERE id = ?", String.class, claimed.get().id());
        assertEquals("SKIPPED", itemStatus);

        // Verify count of songs with external ID 804 is strictly 1
        Integer songCount = jdbc.queryForObject(
                "SELECT COUNT(*) FROM songs WHERE source_provider = 'jamendo' AND source_track_id = '804'", Integer.class);
        assertEquals(1, songCount, "Duplicate song must not be inserted");
    }
}
