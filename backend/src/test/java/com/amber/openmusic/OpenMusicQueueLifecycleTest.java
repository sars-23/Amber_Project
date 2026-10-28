package com.amber.openmusic;

import com.amber.song.Song;
import com.amber.song.SongRepository;
import com.amber.song.SongSourceMetadata;
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
class OpenMusicQueueLifecycleTest {

    @Autowired
    private OpenMusicImportRepository repository;

    @Autowired
    private SongRepository songRepository;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("Queue lifecycle: create, claim, complete, and verify counts")
    void testQueueLifecycle() {
        JamendoTrack track1 = new JamendoTrack("101", "Song A", "Artist A", "Album A", 180,
                "https://storage.jamendo.com/download/101.mp3", "https://jamendo.com/track/101",
                "https://creativecommons.org/licenses/by/4.0/", "Artist A - Song A");
        JamendoTrack track2 = new JamendoTrack("102", "Song B", "Artist B", "Album B", 210,
                "https://storage.jamendo.com/download/102.mp3", "https://jamendo.com/track/102",
                "https://creativecommons.org/licenses/by-sa/4.0/", "Artist B - Song B");

        UUID jobId = repository.createJob(List.of(track1, track2));
        assertNotNull(jobId);

        OpenMusicImportJobView job = repository.findJob(jobId).orElseThrow();
        assertEquals("QUEUED", job.status());
        assertEquals(2, job.total());
        assertEquals(2, job.queued());
        assertEquals(0, job.processing());
        assertEquals(0, job.imported());

        // Claim first track
        Optional<QueuedImportItem> claimed1 = repository.claimNextPending();
        assertTrue(claimed1.isPresent());
        String id1 = claimed1.get().externalTrackId();
        assertTrue(id1.equals("101") || id1.equals("102"));

        OpenMusicImportJobView runningJob = repository.findJob(jobId).orElseThrow();
        assertEquals("RUNNING", runningJob.status());
        assertEquals(1, runningJob.queued());
        assertEquals(1, runningJob.processing());

        // Save a real song to satisfy foreign key constraint
        Song realSong = songRepository.save(new Song("Song " + id1, "Artist " + id1, 180000));
        assertNotNull(realSong.id());

        // Mark first track as IMPORTED with valid song ID
        repository.markItem(claimed1.get().id(), "IMPORTED", null, realSong.id(), 5000000L, "hash" + id1);
        repository.refreshJobStatus(jobId);

        // Claim second track
        Optional<QueuedImportItem> claimed2 = repository.claimNextPending();
        assertTrue(claimed2.isPresent());
        String id2 = claimed2.get().externalTrackId();
        assertTrue(id2.equals("101") || id2.equals("102"));
        assertNotEquals(id1, id2);

        // Mark second track as FAILED
        repository.markItem(claimed2.get().id(), "FAILED", "Download error", null, null, null);
        repository.refreshJobStatus(jobId);

        OpenMusicImportJobView finishedJob = repository.findJob(jobId).orElseThrow();
        assertEquals("COMPLETED_WITH_ERRORS", finishedJob.status());
        assertEquals(1, finishedJob.imported());
        assertEquals(1, finishedJob.failed());
        assertEquals(0, finishedJob.queued());
        assertEquals(0, finishedJob.processing());

        // Retry failed tracks
        int retried = repository.retryFailed(jobId);
        assertEquals(1, retried);

        OpenMusicImportJobView retriedJob = repository.findJob(jobId).orElseThrow();
        assertEquals("QUEUED", retriedJob.status());
        assertEquals(1, retriedJob.queued());
        assertEquals(0, retriedJob.failed());
    }

    @Test
    @DisplayName("Cancellation prevents pending tracks from being processed")
    void testCancelPending() {
        JamendoTrack track1 = new JamendoTrack("201", "Track 1", "Artist 1", "Album 1", 120,
                "https://storage.jamendo.com/201.mp3", "https://jamendo.com/track/201",
                "https://creativecommons.org/licenses/by/4.0/", "Attribution 1");
        JamendoTrack track2 = new JamendoTrack("202", "Track 2", "Artist 2", "Album 2", 150,
                "https://storage.jamendo.com/202.mp3", "https://jamendo.com/track/202",
                "https://creativecommons.org/licenses/by/4.0/", "Attribution 2");

        UUID jobId = repository.createJob(List.of(track1, track2));
        boolean cancelled = repository.requestCancel(jobId);
        assertTrue(cancelled);

        OpenMusicImportJobView job = repository.findJob(jobId).orElseThrow();
        assertEquals("CANCELLED", job.status());
        assertEquals(2, job.cancelled());
        assertEquals(0, job.queued());

        // Claiming next pending should not return cancelled items
        Optional<QueuedImportItem> claimed = repository.claimNextPending();
        assertTrue(claimed.isEmpty());
    }

    @Test
    @DisplayName("Interrupted PROCESSING items recover to PENDING on startup")
    void testRestartRecovery() {
        JamendoTrack track = new JamendoTrack("301", "Recover Track", "Artist", "Album", 100,
                "https://storage.jamendo.com/301.mp3", "https://jamendo.com/track/301",
                "https://creativecommons.org/licenses/by/4.0/", "Attribution");

        UUID jobId = repository.createJob(List.of(track));
        Optional<QueuedImportItem> claimed = repository.claimNextPending();
        assertTrue(claimed.isPresent());

        // Simulate crash/timeout: expire the lease
        jdbc.update("UPDATE open_music_import_items SET lease_until = ?",
                Timestamp.from(Instant.now().minus(Duration.ofMinutes(10))));

        // Simulate recovery
        repository.recoverInterruptedJobs();

        OpenMusicImportJobView recovered = repository.findJob(jobId).orElseThrow();
        assertEquals("QUEUED", recovered.status());
        assertEquals(1, recovered.queued());
        assertEquals(0, recovered.processing());
    }

    @Test
    @DisplayName("Deduplication by provider source ID and SHA-256 content hash")
    void testDeduplication() {
        SongSourceMetadata metadata = new SongSourceMetadata("jamendo", "401",
                "https://jamendo.com/track/401", "https://creativecommons.org/licenses/by/4.0/",
                "Artist - Track", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

        Song song = new Song("Original Track", "Artist", 120000);
        Song saved = songRepository.saveFromSource(song, metadata);
        assertNotNull(saved.id());

        // Look up by source ID
        Optional<Long> bySource = songRepository.findIdBySource("jamendo", "401");
        assertTrue(bySource.isPresent());
        assertEquals(saved.id(), bySource.get());

        // Look up by content SHA-256
        Optional<Long> byContent = songRepository.findIdByContentSha256("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assertTrue(byContent.isPresent());
        assertEquals(saved.id(), byContent.get());

        // Non-existent source and content return empty
        assertTrue(songRepository.findIdBySource("jamendo", "999999").isEmpty());
        assertTrue(songRepository.findIdByContentSha256("0000000000000000000000000000000000000000000000000000000000000000").isEmpty());
    }
}
