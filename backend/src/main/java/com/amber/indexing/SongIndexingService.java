package com.amber.indexing;

import com.amber.audio.AudioDecoderService;
import com.amber.audio.PcmAudio;
import com.amber.fingerprint.Fingerprint;
import com.amber.fingerprint.FingerprintGenerator;
import com.amber.song.Song;
import com.amber.song.SongRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Objects;

import com.amber.song.SongSourceMetadata;

/**
 * Service orchestrating transactional indexing of complete audio recordings into PostgreSQL.
 */
@Service
public class SongIndexingService {

    private static final Logger log = LoggerFactory.getLogger(SongIndexingService.class);

    private final SongRepository songRepository;
    private final FingerprintRepository fingerprintRepository;
    private final AudioDecoderService audioDecoderService;
    private final FingerprintGenerator fingerprintGenerator;

    public SongIndexingService(SongRepository songRepository,
                               FingerprintRepository fingerprintRepository,
                               AudioDecoderService audioDecoderService,
                               FingerprintGenerator fingerprintGenerator) {
        this.songRepository = songRepository;
        this.fingerprintRepository = fingerprintRepository;
        this.audioDecoderService = audioDecoderService;
        this.fingerprintGenerator = fingerprintGenerator;
    }

    /**
     * Ingests, normalizes, fingerprints, and indexes a song within a single transaction.
     */
    @Transactional
    public Song indexSong(String title, String artist, byte[] audioBytes, String filenameHint) {
        Objects.requireNonNull(title, "Title cannot be null");
        Objects.requireNonNull(artist, "Artist cannot be null");

        log.info("Starting indexing for track '{}' by '{}' ({} bytes)", title, artist, audioBytes != null ? audioBytes.length : 0);
        PcmAudio pcmAudio = audioDecoderService.decodeAndNormalize(audioBytes, filenameHint);
        return indexDecoded(title, artist, pcmAudio, null);
    }

    /**
     * Ingests a source track and retains provenance metadata atomically with fingerprints.
     */
    @Transactional
    public Song indexSongFromSource(String title, String artist, byte[] audioBytes, String filenameHint,
                                    SongSourceMetadata sourceMetadata) {
        Objects.requireNonNull(title, "Title cannot be null");
        Objects.requireNonNull(artist, "Artist cannot be null");
        Objects.requireNonNull(sourceMetadata, "Source metadata cannot be null");

        log.info("Starting source indexing for '{}' by '{}' ({} bytes)", title, artist, audioBytes != null ? audioBytes.length : 0);
        PcmAudio pcmAudio = audioDecoderService.decodeAndNormalize(audioBytes, filenameHint);
        return indexDecoded(title, artist, pcmAudio, sourceMetadata);
    }

    /**
     * Transactional indexing for already decoded PcmAudio (useful for fixtures and programmatic indexing).
     */
    @Transactional
    public Song indexPcmAudio(String title, String artist, PcmAudio pcmAudio) {
        return indexDecoded(title, artist, pcmAudio, null);
    }

    private Song indexDecoded(String title, String artist, PcmAudio pcmAudio, SongSourceMetadata sourceMetadata) {
        long startTime = System.currentTimeMillis();

        // 1. Generate constellation fingerprints
        List<Fingerprint> fingerprints = fingerprintGenerator.generateFingerprints(pcmAudio);

        // 2. Persist song record (with or without source metadata)
        Song song = new Song(title.trim(), artist.trim(), pcmAudio.getDurationMs());
        Song savedSong = (sourceMetadata == null)
                ? songRepository.save(song)
                : songRepository.saveFromSource(song, sourceMetadata);

        // 3. Batch insert fingerprints
        int inserted = fingerprintRepository.batchInsert(savedSong.id(), fingerprints);

        // 4. Update fingerprint count on song record
        songRepository.updateFingerprintCount(savedSong.id(), inserted);

        long totalTime = System.currentTimeMillis() - startTime;
        log.info("Successfully indexed song id={} ('{}' by '{}') with {} fingerprints in {}ms",
                savedSong.id(), savedSong.title(), savedSong.artist(), inserted, totalTime);

        return savedSong.withIdAndCounts(savedSong.id(), inserted, savedSong.createdAt());
    }
}
