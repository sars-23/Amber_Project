package com.amber.dsp;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class StftProcessorTest {

    @Test
    @DisplayName("Should correctly calculate STFT dimensions and resolutions")
    void testDimensionsAndResolutions() {
        int frameSize = 1024;
        int hopSize = 512;
        int sampleRate = 11025;

        StftProcessor stft = new StftProcessor(frameSize, hopSize);

        assertThat(stft.getNumBins()).isEqualTo(513); // 1024 / 2 + 1
        assertThat(stft.getFrequencyResolution(sampleRate)).isCloseTo(10.7666, org.assertj.core.data.Offset.offset(0.001));
        assertThat(stft.getTimeResolution(sampleRate)).isCloseTo(0.04644, org.assertj.core.data.Offset.offset(0.0001));

        // Frequency to bin mapping
        assertThat(stft.frequencyToBin(440.0, sampleRate)).isEqualTo(41);
        assertThat(stft.binToFrequency(41, sampleRate)).isCloseTo(441.43, org.assertj.core.data.Offset.offset(0.1));

        // Timestamp mapping
        assertThat(stft.frameIndexToTimeMs(10, sampleRate)).isEqualTo(464L);
    }

    @Test
    @DisplayName("Should compute correct number of frames for input length")
    void testComputeSpectrogram() {
        StftProcessor stft = new StftProcessor(1024, 512);

        // 2048 samples: frames at offset 0, 512, 1024 -> (2048 - 1024)/512 + 1 = 3 frames
        double[] samples = new double[2048];
        double[][] spec = stft.computeSpectrogram(samples);

        assertThat(spec).hasDimensions(3, 513);
    }

    @Test
    @DisplayName("Should return empty spectrogram when input shorter than frameSize")
    void testShortInput() {
        StftProcessor stft = new StftProcessor(1024, 512);
        double[] shortSamples = new double[500];

        double[][] spec = stft.computeSpectrogram(shortSamples);
        assertThat(spec).isEmpty();
    }

    @Test
    @DisplayName("Should reject invalid configuration")
    void testInvalidConfig() {
        assertThatThrownBy(() -> new StftProcessor(1000, 500)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new StftProcessor(1024, 0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new StftProcessor(1024, 2048)).isInstanceOf(IllegalArgumentException.class);
    }
}
