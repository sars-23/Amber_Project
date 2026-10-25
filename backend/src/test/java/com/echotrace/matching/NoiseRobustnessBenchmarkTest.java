package com.echotrace.matching;

import com.echotrace.audio.PcmAudio;
import com.echotrace.song.Song;
import com.echotrace.util.SyntheticAudioGenerator;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.util.List;
import java.util.Random;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class NoiseRobustnessBenchmarkTest {

    @Autowired
    private com.echotrace.indexing.SongIndexingService indexingService;

    @Autowired
    private AudioMatchingService matchingService;

    @Autowired
    private com.echotrace.fingerprint.FingerprintGenerator fingerprintGenerator;

    @Test
    @DisplayName("Evaluate matching accuracy across SNR noise levels: clean, +20dB, +10dB, +6dB, and 0dB")
    void evaluateNoiseRobustness() throws IOException {
        int sampleRate = 11025;
        // Notes: C4, E4, G4, B4, C5, E5, G5, B5, A5, F5, D5, G4 (12 notes, 1.0s each = 12s total)
        double[] notes = {261.63, 329.63, 392.00, 493.88, 523.25, 659.25, 783.99, 987.77, 880.00, 698.46, 587.33, 392.00};
        short[] fullSongSamples = SyntheticAudioGenerator.generateMelody(notes, 1.0, sampleRate);
        byte[] trackWav = SyntheticAudioGenerator.createWavFile(fullSongSamples, sampleRate);

        Song indexedSong = indexingService.indexSong("Benchmark Symphony", "DSP Maestro", trackWav, "benchmark.wav");
        assertThat(indexedSong).isNotNull();

        // Extract a 4-second excerpt starting at offset 3000ms
        PcmAudio fullPcm = new PcmAudio(fullSongSamples, sampleRate);
        short[] cleanExcerptSamples = fullPcm.slice(3000L, 4000L).getSamples();

        double[] snrLevelsDb = {Double.POSITIVE_INFINITY, 20.0, 10.0, 6.0, 0.0};
        Random rng = new Random(42);

        System.out.println("==========================================================================");
        System.out.println("ECHOTRACE NOISE ROBUSTNESS BENCHMARK");
        System.out.println("Track: 'Benchmark Symphony' (12s, 11,025 Hz)");
        System.out.println("Query: 4.0s excerpt starting at t=3000ms");
        System.out.println("--------------------------------------------------------------------------");
        System.out.printf("%-10s | %-8s | %-14s | %-14s | %-10s%n", "SNR (dB)", "Matched?", "Estimated (ms)", "Peak Votes", "Confidence");
        System.out.println("--------------------------------------------------------------------------");

        for (double snrDb : snrLevelsDb) {
            short[] noisySamples = addGaussianNoise(cleanExcerptSamples, snrDb, rng);
            PcmAudio noisyPcm = new PcmAudio(noisySamples, sampleRate);

            String snrLabel = Double.isInfinite(snrDb) ? "Clean" : String.format("%+4.0f dB", snrDb);
            long start = System.nanoTime();
            MatchResult result = matchingService.matchPcm(noisyPcm);
            long elapsedMs = (System.nanoTime() - start) / 1_000_000;

            System.out.printf("%-10s | %-8s | %-14d | %-14d | %-10.2f (%d ms)%n",
                    snrLabel,
                    result.matched() ? "YES" : "NO",
                    result.estimatedOffsetMs(),
                    result.matchingHashes(),
                    result.confidence(),
                    elapsedMs
            );

            assertThat(result.matched()).as("Should match at SNR " + snrLabel).isTrue();
            assertThat(result.song().id()).isEqualTo(indexedSong.id());

            // High to moderate SNR (Clean down to +6 dB) must maintain strict offset accuracy <= 250ms
            if (Double.isInfinite(snrDb) || snrDb >= 6.0) {
                assertThat(Math.abs(result.estimatedOffsetMs() - 3000))
                        .as("Offset error should be within 250ms at " + snrLabel)
                        .isLessThanOrEqualTo(250);
                assertThat(result.confidence()).as("Confidence should be >= 0.80").isGreaterThanOrEqualTo(0.80);
            } else {
                // At 0 dB SNR (100% noise floor), match is identified with relaxed offset tolerance
                assertThat(Math.abs(result.estimatedOffsetMs() - 3000))
                        .as("Offset error at 0 dB should be within 1000ms")
                        .isLessThanOrEqualTo(1000);
            }
        }
        System.out.println("==========================================================================");
    }

    @Test
    @DisplayName("Verify matching across multiple excerpt positions: 1000ms, 4500ms, and 7000ms")
    void evaluateMultipleOffsets() throws IOException {
        int sampleRate = 11025;
        double[] notes = {261.63, 329.63, 392.00, 493.88, 523.25, 659.25, 783.99, 987.77, 880.00, 698.46, 587.33, 392.00};
        short[] fullSongSamples = SyntheticAudioGenerator.generateMelody(notes, 1.0, sampleRate);
        byte[] trackWav = SyntheticAudioGenerator.createWavFile(fullSongSamples, sampleRate);

        Song indexedSong = indexingService.indexSong("Multi-Offset Track", "Echo Master", trackWav, "multi_offset.wav");
        PcmAudio fullPcm = new PcmAudio(fullSongSamples, sampleRate);

        long[] testOffsetsMs = {1000L, 4500L, 7000L};

        for (long testOffset : testOffsetsMs) {
            short[] excerpt = fullPcm.slice(testOffset, 3500L).getSamples();
            PcmAudio excerptPcm = new PcmAudio(excerpt, sampleRate);

            MatchResult result = matchingService.matchPcm(excerptPcm);
            System.out.println("DEBUG testOffset=" + testOffset + "ms -> estimated=" + result.estimatedOffsetMs() + "ms (top buckets: " + result.offsetHistogram() + ")");

            assertThat(result.matched()).isTrue();
            assertThat(result.song().id()).isEqualTo(indexedSong.id());
            assertThat(Math.abs(result.estimatedOffsetMs() - testOffset))
                    .as("Offset error for position " + testOffset + "ms should be <= 250ms")
                    .isLessThanOrEqualTo(250);
        }
    }

    @Test
    @DisplayName("Verify rejection of unrelated audio and pure noise")
    void evaluateUnrelatedAudioRejection() throws IOException {
        int sampleRate = 11025;
        // Index track with specific notes
        double[] indexedNotes = {261.63, 329.63, 392.00, 523.25};
        byte[] indexedWav = SyntheticAudioGenerator.createWavFile(
                SyntheticAudioGenerator.generateMelody(indexedNotes, 1.5, sampleRate),
                sampleRate
        );
        indexingService.indexSong("Indexed Reference", "Original Band", indexedWav, "indexed.wav");

        // 1. Query with unrelated frequencies (e.g. high pitch whistling 2500Hz, 3200Hz, 4100Hz)
        double[] unrelatedNotes = {2500.0, 3200.0, 4100.0};
        short[] unrelatedSamples = SyntheticAudioGenerator.generateMelody(unrelatedNotes, 1.0, sampleRate);
        MatchResult unrelatedResult = matchingService.matchPcm(new PcmAudio(unrelatedSamples, sampleRate));
        assertThat(unrelatedResult.matched()).as("Unrelated melody must return no match").isFalse();

        // 2. Query with pure Gaussian white noise
        Random rng = new Random(99);
        short[] whiteNoise = new short[sampleRate * 4];
        for (int i = 0; i < whiteNoise.length; i++) {
            whiteNoise[i] = (short) (rng.nextGaussian() * 8000);
        }
        MatchResult noiseResult = matchingService.matchPcm(new PcmAudio(whiteNoise, sampleRate));
        assertThat(noiseResult.matched()).as("Pure white noise must return no match").isFalse();
    }

    private short[] addGaussianNoise(short[] input, double snrDb, Random rng) {
        if (Double.isInfinite(snrDb)) {
            return input.clone();
        }

        double signalPower = 0.0;
        for (short s : input) {
            signalPower += (double) s * s;
        }
        signalPower /= input.length;

        double noisePower = signalPower / Math.pow(10.0, snrDb / 10.0);
        double noiseStdDev = Math.sqrt(noisePower);

        short[] output = new short[input.length];
        for (int i = 0; i < input.length; i++) {
            double noise = rng.nextGaussian() * noiseStdDev;
            double combined = input[i] + noise;
            output[i] = (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, Math.round(combined)));
        }
        return output;
    }
}
