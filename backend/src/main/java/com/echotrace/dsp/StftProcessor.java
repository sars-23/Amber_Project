package com.echotrace.dsp;

import com.echotrace.audio.PcmAudio;

import java.util.Arrays;

/**
 * Short-Time Fourier Transform (STFT) processor.
 * Splits continuous PCM audio into overlapping Hann-windowed frames,
 * computes Radix-2 FFT, and produces single-sided magnitude spectrogram frames.
 */
public final class StftProcessor {

    private final int frameSize;
    private final int hopSize;
    private final Fft fft;
    private final HannWindow hannWindow;

    public StftProcessor(int frameSize, int hopSize) {
        if (frameSize <= 0 || (frameSize & (frameSize - 1)) != 0) {
            throw new IllegalArgumentException("Frame size must be a power of 2: " + frameSize);
        }
        if (hopSize <= 0 || hopSize > frameSize) {
            throw new IllegalArgumentException("Hop size must be between 1 and frameSize: " + hopSize);
        }
        this.frameSize = frameSize;
        this.hopSize = hopSize;
        this.fft = new Fft(frameSize);
        this.hannWindow = new HannWindow(frameSize);
    }

    public int getFrameSize() {
        return frameSize;
    }

    public int getHopSize() {
        return hopSize;
    }

    public int getNumBins() {
        return (frameSize / 2) + 1;
    }

    /**
     * Computes the frequency resolution in Hz per bin.
     * e.g. at sampleRate=11025 and frameSize=1024, deltaF = 10.7666 Hz/bin.
     */
    public double getFrequencyResolution(int sampleRate) {
        return (double) sampleRate / frameSize;
    }

    /**
     * Computes temporal resolution in seconds per hop.
     * e.g. at sampleRate=11025 and hopSize=512, deltaT = 46.439 ms/hop.
     */
    public double getTimeResolution(int sampleRate) {
        return (double) hopSize / sampleRate;
    }

    /**
     * Converts a bin index to its center frequency in Hz.
     */
    public double binToFrequency(int binIndex, int sampleRate) {
        return binIndex * getFrequencyResolution(sampleRate);
    }

    /**
     * Converts a frequency in Hz to the nearest FFT bin index.
     */
    public int frequencyToBin(double frequencyHz, int sampleRate) {
        int bin = (int) Math.round(frequencyHz / getFrequencyResolution(sampleRate));
        return Math.max(0, Math.min(frameSize / 2, bin));
    }

    /**
     * Converts a frame index to its timestamp in milliseconds.
     */
    public long frameIndexToTimeMs(int frameIndex, int sampleRate) {
        return Math.round(((double) frameIndex * hopSize / sampleRate) * 1000.0);
    }

    /**
     * Processes PCM audio into an array of single-sided magnitude spectra.
     * Output shape: [numFrames][(frameSize / 2) + 1]
     */
    public double[][] computeSpectrogram(PcmAudio pcmAudio) {
        return computeSpectrogram(pcmAudio.toDoubleArray());
    }

    /**
     * Processes normalized double samples [-1.0, 1.0] into magnitude spectrogram frames.
     */
    public double[][] computeSpectrogram(double[] samples) {
        if (samples.length < frameSize) {
            return new double[0][0];
        }

        int numFrames = (samples.length - frameSize) / hopSize + 1;
        int numBins = (frameSize / 2) + 1;
        double[][] spectrogram = new double[numFrames][numBins];

        // Reusable thread-confined work buffers to prevent GC thrashing
        double[] real = new double[frameSize];
        double[] imag = new double[frameSize];

        for (int frame = 0; frame < numFrames; frame++) {
            int offset = frame * hopSize;

            // Apply Hann window directly from samples into real buffer
            hannWindow.apply(samples, offset, real);
            Arrays.fill(imag, 0.0);

            // Execute FFT
            fft.transform(real, imag);

            // Calculate magnitude spectrum
            spectrogram[frame] = fft.computeMagnitudeSpectrum(real, imag);
        }

        return spectrogram;
    }
}
