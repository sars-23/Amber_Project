package com.echotrace.indexing;

import com.echotrace.audio.PcmAudio;
import com.echotrace.song.Song;
import com.echotrace.song.SongRepository;
import com.echotrace.util.SyntheticAudioGenerator;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class SongIndexingServiceIntegrationTest {

    @Autowired
    private SongIndexingService songIndexingService;

    @Autowired
    private SongRepository songRepository;

    @Autowired
    private FingerprintRepository fingerprintRepository;

    @Test
    @DisplayName("Should transactionally index synthetic audio recording and persist fingerprints")
    void testIndexSong() {
        short[] samples = SyntheticAudioGenerator.generateHarmonicChord(
                new double[]{440.0, 880.0, 1320.0}, 3.0, 11025);
        PcmAudio pcm = new PcmAudio(samples, 11025);

        Song indexed = songIndexingService.indexPcmAudio("Synthetic Symphony", "Test Artist", pcm);

        assertThat(indexed.id()).isNotNull();
        assertThat(indexed.fingerprintCount()).isGreaterThan(0);

        // Verify stored in DB
        Song fromDb = songRepository.findById(indexed.id()).orElseThrow();
        assertThat(fromDb.title()).isEqualTo("Synthetic Symphony");
        assertThat(fromDb.fingerprintCount()).isEqualTo(indexed.fingerprintCount());
        assertThat(fromDb.durationMs()).isEqualTo(3000L);
    }
}
