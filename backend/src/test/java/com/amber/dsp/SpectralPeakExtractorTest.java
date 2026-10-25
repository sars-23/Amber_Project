package com.amber.dsp;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SpectralPeakExtractorTest {

    @Test
    @DisplayName("Should extract peak corresponding to prominent 440 Hz tone")
    void testExtractPeakFor440Hz() {
        int frameSize = 1024;
        int hopSize = 512;
        int sampleRate = 11025;

        StftProcessor stft = new StftProcessor(frameSize, hopSize);
        SpectralPeakExtractor extractor = new SpectralPeakExtractor();

        // 1 second of 440 Hz tone
        int numSamples = sampleRate;
        double[] samples = new double[numSamples];
        for (int i = 0; i < numSamples; i++) {
            double t = (double) i / sampleRate;
            samples[i] = Math.sin(2 * Math.PI * 440.0 * t);
        }

        double[][] spectrogram = stft.computeSpectrogram(samples);
        List<SpectralPeak> peaks = extractor.extractPeaks(spectrogram);

        assertThat(peaks).isNotEmpty();

        // Peak should be in bin 41 (or immediately adjacent bin 40-42)
        boolean found440HzPeak = peaks.stream()
                .anyMatch(p -> Math.abs(p.frequencyBin() - 41) <= 1);
        assertThat(found440HzPeak).isTrue();
    }

    @Test
    @DisplayName("Should return empty list for silence or empty spectrogram")
    void testSilence() {
        SpectralPeakExtractor extractor = new SpectralPeakExtractor();
        assertThat(extractor.extractPeaks(new double[0][0])).isEmpty();

        double[][] silentSpec = new double[10][513];
        assertThat(extractor.extractPeaks(silentSpec)).isEmpty();
    }
}
