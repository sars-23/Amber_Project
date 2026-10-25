package com.amber.dsp;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FftTest {

    @Test
    @DisplayName("Should reject non-power-of-two sizes")
    void testInvalidSizes() {
        assertThatThrownBy(() -> new Fft(0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Fft(1000)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Fft(1023)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("Should detect 440 Hz pure sine wave at bin 41 for N=1024 and fs=11025 Hz")
    void test440HzSineWave() {
        int n = 1024;
        int fs = 11025;
        double targetFreq = 440.0;
        double deltaF = (double) fs / n; // 10.7666 Hz/bin
        int expectedBin = (int) Math.round(targetFreq / deltaF); // 41

        Fft fft = new Fft(n);
        double[] real = new double[n];
        double[] imag = new double[n];

        // Generate pure sine wave: sin(2 * pi * 440 * t)
        for (int i = 0; i < n; i++) {
            double t = (double) i / fs;
            real[i] = Math.sin(2.0 * Math.PI * targetFreq * t);
        }

        fft.transform(real, imag);
        double[] magnitudes = fft.computeMagnitudeSpectrum(real, imag);

        // Find the bin with maximum magnitude
        int peakBin = 0;
        double maxMag = -1.0;
        for (int k = 1; k < magnitudes.length; k++) { // Skip DC
            if (magnitudes[k] > maxMag) {
                maxMag = magnitudes[k];
                peakBin = k;
            }
        }

        assertThat(peakBin).isEqualTo(expectedBin);
        // Magnitude at peak should be significantly higher than neighbor far away
        assertThat(maxMag).isGreaterThan(100.0);
        assertThat(magnitudes[10]).isLessThan(5.0);
        assertThat(magnitudes[100]).isLessThan(5.0);
    }

    @Test
    @DisplayName("DC constant signal should produce peak strictly at bin 0")
    void testDcSignal() {
        int n = 1024;
        Fft fft = new Fft(n);
        double[] real = new double[n];
        double[] imag = new double[n];

        for (int i = 0; i < n; i++) {
            real[i] = 1.0;
        }

        fft.transform(real, imag);
        double[] magnitudes = fft.computeMagnitudeSpectrum(real, imag);

        assertThat(magnitudes[0]).isCloseTo(1024.0, org.assertj.core.data.Offset.offset(0.001));
        for (int i = 1; i < magnitudes.length; i++) {
            assertThat(magnitudes[i]).isCloseTo(0.0, org.assertj.core.data.Offset.offset(0.001));
        }
    }

    @Test
    @DisplayName("Dual tone signal should produce peaks at both frequencies")
    void testDualToneSignal() {
        int n = 1024;
        int fs = 11025;
        double deltaF = (double) fs / n;

        int bin1 = 30; // ~323 Hz
        int bin2 = 80; // ~861 Hz
        double freq1 = bin1 * deltaF;
        double freq2 = bin2 * deltaF;

        Fft fft = new Fft(n);
        double[] real = new double[n];
        double[] imag = new double[n];

        for (int i = 0; i < n; i++) {
            double t = (double) i / fs;
            real[i] = Math.sin(2.0 * Math.PI * freq1 * t) + Math.sin(2.0 * Math.PI * freq2 * t);
        }

        fft.transform(real, imag);
        double[] magnitudes = fft.computeMagnitudeSpectrum(real, imag);

        assertThat(magnitudes[bin1]).isGreaterThan(400.0);
        assertThat(magnitudes[bin2]).isGreaterThan(400.0);
    }
}
