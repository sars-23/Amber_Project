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

    @Test
    @DisplayName("Evaluate matching accuracy across SNR noise levels: clean, +20dB, +10dB, +6dB, and 0dB")
    void evaluateNoiseRobustness() throws java.io.IOException {
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

            long start = System.nanoTime();
            MatchResult result = matchingService.matchPcm(noisyPcm);
            long elapsedMs = (System.nanoTime() - start) / 1_000_000;

            String snrLabel = Double.isInfinite(snrDb) ? "Clean" : String.format("%+4.0f dB", snrDb);
            System.out.printf("%-10s | %-8s | %-14d | %-14d | %-10.2f (%d ms)%n",
                    snrLabel,
                    result.matched() ? "YES" : "NO",
                    result.estimatedOffsetMs(),
                    result.matchingHashes(),
                    result.confidence(),
                    elapsedMs
            );

            // Clean excerpt must match the indexed song and accurately identify offset around 3000ms
            if (Double.isInfinite(snrDb)) {
                assertThat(result.matched()).isTrue();
                assertThat(result.song().id()).isEqualTo(indexedSong.id());
                // Offset tolerance +/- 250ms
                assertThat(Math.abs(result.estimatedOffsetMs() - 3000)).isLessThanOrEqualTo(250);
            }
        }
        System.out.println("==========================================================================");
    }

    private short[] addGaussianNoise(short[] input, double snrDb, Random rng) {
        if (Double.isInfinite(snrDb)) {
            return input.clone();
        }

        // Calculate signal power
        double signalPower = 0.0;
        for (short s : input) {
            signalPower += (double) s * s;
        }
        signalPower /= input.length;

        // SNR = 10 * log10(signalPower / noisePower) => noisePower = signalPower / 10^(SNR/10)
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
