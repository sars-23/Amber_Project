package com.amber.benchmark;

import com.amber.audio.AudioDecoderService;
import com.amber.benchmark.dto.BenchmarkResponse;
import com.amber.fingerprint.FingerprintGenerator;
import com.amber.song.SongRepository;
import com.amber.util.SyntheticAudioGenerator;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class RobustnessBenchmarkServiceTest {

    @Autowired
    private RobustnessBenchmarkService benchmarkService;

    @Autowired
    private AudioDecoderService audioDecoderService;

    @Autowired
    private FingerprintGenerator fingerprintGenerator;

    @Autowired
    private SongRepository songRepository;

    @Test
    @DisplayName("Should benchmark clean built-in symphony and verify exact offset alignment without database records")
    void shouldBenchmarkCleanReferenceTrack() {
        int initialSongCount = songRepository.findAll(0, 100).size();

        BenchmarkResponse response = benchmarkService.runBenchmark(
                null, // Use built-in 12s reference melody
                "benchmark.wav",
                Double.POSITIVE_INFINITY, // Clean (no noise)
                3.0,                     // Target offset: 3.0s (3000ms)
                4.0                      // Excerpt duration: 4.0s
        );

        assertThat(response).isNotNull();
        assertThat(response.matched()).isTrue();
        assertThat(response.targetOffsetMs()).isEqualTo(3000);
        // Clean matching must have offset accuracy within 250ms
        assertThat(response.offsetErrorMs()).isLessThanOrEqualTo(250);
        assertThat(response.confidence()).isGreaterThanOrEqualTo(0.80);
        assertThat(response.matchedFingerprints()).isGreaterThan(20);
        assertThat(response.explanation()).contains("Acoustic constellation survived");

        // Verify zero persistent songs or fingerprints were created in the database
        int finalSongCount = songRepository.findAll(0, 100).size();
        assertThat(finalSongCount).isEqualTo(initialSongCount);
    }

    @Test
    @DisplayName("Should evaluate reference track under +10 dB Gaussian noise with time-coherence")
    void shouldBenchmarkUnderNoise() {
        BenchmarkResponse response = benchmarkService.runBenchmark(
                null,
                "benchmark.wav",
                10.0, // +10 dB SNR
                2.0,  // Target offset: 2.0s (2000ms)
                4.0
        );

        assertThat(response).isNotNull();
        assertThat(response.matched()).isTrue();
        assertThat(response.targetOffsetMs()).isEqualTo(2000);
        assertThat(response.offsetErrorMs()).isLessThanOrEqualTo(250);
        assertThat(response.confidence()).isGreaterThanOrEqualTo(0.70);
    }

    @Test
    @DisplayName("Should correctly return no-match when querying an unrelated audio sample")
    void shouldReturnNoMatchForUnrelatedAudio() throws IOException {
        // Query: Unrelated pure sine wave audio sample
        short[] unrelatedSamples = SyntheticAudioGenerator.generateSineSamples(180.0, 4.0, 11025, 0.7);
        byte[] unrelatedQueryWav = SyntheticAudioGenerator.createWavFile(unrelatedSamples, 11025);

        // Run benchmark with built-in melody reference against unrelated query audio
        BenchmarkResponse response = benchmarkService.runBenchmark(
                null,
                "builtin.wav",
                unrelatedQueryWav,
                "sine180.wav",
                30.0,
                0.0,
                4.0
        );

        assertThat(response).isNotNull();
        assertThat(response.matched()).isFalse();
        assertThat(response.confidence()).isLessThan(0.30);
    }

    @Test
    @DisplayName("Should reject reference files exceeding 10 MB limit")
    void shouldRejectOversizedFiles() {
        byte[] oversizedData = new byte[RobustnessBenchmarkService.MAX_FILE_SIZE_BYTES + 1024];

        assertThatThrownBy(() -> benchmarkService.runBenchmark(
                oversizedData,
                "huge.wav",
                20.0,
                0.0,
                4.0
        )).isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("10 MB limit");
    }
}
