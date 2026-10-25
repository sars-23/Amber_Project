package com.amber.matching;

import com.amber.audio.PcmAudio;
import com.amber.indexing.SongIndexingService;
import com.amber.song.Song;
import com.amber.util.SyntheticAudioGenerator;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class AudioMatchingServiceTest {

    @Autowired
    private SongIndexingService indexingService;

    @Autowired
    private AudioMatchingService matchingService;

    @Test
    @DisplayName("Should accurately identify a cropped excerpt from an indexed audio recording")
    void testMatchCroppedExcerpt() {
        // 1. Create a 6-second synthetic track with a sequence of notes
        short[] fullSongSamples = SyntheticAudioGenerator.generateMelody(
                new double[]{330.0, 440.0, 550.0, 660.0, 770.0, 880.0}, 1.0, 11025);
        PcmAudio fullSong = new PcmAudio(fullSongSamples, 11025);

        Song indexedSong = indexingService.indexPcmAudio("Harmonic Master", "DSP Ensemble", fullSong);
        assertThat(indexedSong.fingerprintCount()).isGreaterThan(0);

        // 2. Crop a 2.5-second excerpt starting at offset 1000ms (beginning of note 1)
        long trueOffsetMs = 1000;
        long excerptDurationMs = 2500;
        PcmAudio queryExcerpt = fullSong.slice(trueOffsetMs, excerptDurationMs);

        // 3. Submit excerpt for recognition
        MatchResult result = matchingService.matchPcm(queryExcerpt);

        assertThat(result.matched()).isTrue();
        assertThat(result.song()).isNotNull();
        assertThat(result.song().id()).isEqualTo(indexedSong.id());
        assertThat(result.song().title()).isEqualTo("Harmonic Master");
        assertThat(result.score()).isGreaterThan(AudioMatchingService.MIN_SCORE_THRESHOLD);
        assertThat(result.confidence()).isGreaterThan(0.5);

        // Timestamp offset tolerance check: estimated offset should be within ±100ms of true offset 1500ms
        assertThat(result.estimatedOffsetMs()).isBetween((int) (trueOffsetMs - 100), (int) (trueOffsetMs + 100));
        assertThat(result.searchDurationMs()).isGreaterThan(0.0);
    }

    @Test
    @DisplayName("Should return no-match for unrelated audio signals")
    void testNoMatchForUnrelatedAudio() {
        // Index a track with low frequencies
        short[] songSamples = SyntheticAudioGenerator.generateHarmonicChord(
                new double[]{150.0, 200.0, 250.0}, 4.0, 11025);
        indexingService.indexPcmAudio("Low Tone Song", "Bass Band", new PcmAudio(songSamples, 11025));

        // Query with high frequencies completely different
        short[] querySamples = SyntheticAudioGenerator.generateHarmonicChord(
                new double[]{2400.0, 3200.0, 4100.0}, 2.0, 11025);
        PcmAudio queryAudio = new PcmAudio(querySamples, 11025);

        MatchResult result = matchingService.matchPcm(queryAudio);

        assertThat(result.matched()).isFalse();
        assertThat(result.song()).isNull();
    }
}
