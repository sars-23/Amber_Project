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
}
