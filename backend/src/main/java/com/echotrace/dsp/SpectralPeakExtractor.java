package com.echotrace.dsp;

import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Extracts salient spectral peaks (constellation points) from an STFT magnitude spectrogram.
 * Uses logarithmic frequency bands, local neighborhood maximum filtering, and adaptive energy thresholds.
 */
@Component
public class SpectralPeakExtractor {

    // Default logarithmic frequency band boundaries for 1024-point FFT at 11025 Hz (~10.77 Hz/bin)
    // Excludes DC (0..2)
    // Logarithmic frequency band boundaries for 1024-point FFT at 11025 Hz (~10.77 Hz/bin)
    // Excludes DC / Sub-audible rumble (0..2)
    public static final int[][] DEFAULT_BANDS = new int[][]{
            {3, 10},     // 32 - 108 Hz
            {11, 20},    // 118 - 215 Hz
            {21, 35},    // 226 - 377 Hz
            {36, 55},    // 388 - 592 Hz
            {56, 85},    // 603 - 915 Hz
            {86, 130},   // 926 - 1400 Hz
            {131, 190},  // 1410 - 2046 Hz
            {191, 280},  // 2056 - 3015 Hz
            {281, 390},  // 3025 - 4199 Hz
            {391, 511}   // 4210 - 5500 Hz
    };

    private final int[][] frequencyBands;
    private final double minPeakMagnitude;
    private final int timeNeighborhood;
    private final int freqNeighborhood;
    private final int maxPeaksPerFrame;

    public SpectralPeakExtractor() {
        this(DEFAULT_BANDS, 3.0, 1, 2, 6);
    }

    public SpectralPeakExtractor(int[][] frequencyBands, double minPeakMagnitude, int timeNeighborhood, int freqNeighborhood, int maxPeaksPerFrame) {
        this.frequencyBands = frequencyBands;
        this.minPeakMagnitude = minPeakMagnitude;
        this.timeNeighborhood = timeNeighborhood;
        this.freqNeighborhood = freqNeighborhood;
        this.maxPeaksPerFrame = maxPeaksPerFrame;
    }

    /**
     * Extracts a sorted list of spectral peaks from a 2D spectrogram [frames][bins].
     */
    public List<SpectralPeak> extractPeaks(double[][] spectrogram) {
        if (spectrogram == null || spectrogram.length == 0 || spectrogram[0].length == 0) {
            return Collections.emptyList();
        }

        int numFrames = spectrogram.length;
        int numBins = spectrogram[0].length;
        List<SpectralPeak> allPeaks = new ArrayList<>();
        int[] lastPeakFrameInBand = new int[frequencyBands.length];
        Arrays.fill(lastPeakFrameInBand, -99);

        for (int frame = 0; frame < numFrames; frame++) {
            // Compute frame noise floor for adaptive thresholding
            double frameEnergySum = 0.0;
            int count = 0;
            for (int b = 3; b < numBins; b++) {
                frameEnergySum += spectrogram[frame][b];
                count++;
            }
            double frameMean = count > 0 ? (frameEnergySum / count) : 0.0;
            double dynamicThreshold = Math.max(minPeakMagnitude, frameMean * 2.0);

            List<SpectralPeak> frameCandidates = new ArrayList<>();

            for (int bandIdx = 0; bandIdx < frequencyBands.length; bandIdx++) {
                int[] band = frequencyBands[bandIdx];
                int minBin = Math.max(2, band[0]);
                int maxBin = Math.min(numBins - 2, band[1]);

                double highestMagInBand = -1.0;
                int bestBinInBand = -1;

                for (int bin = minBin; bin <= maxBin; bin++) {
                    double mag = spectrogram[frame][bin];

                    if (mag < dynamicThreshold) {
                        continue;
                    }

                    // Must be a local maximum across frequency bins
                    if (mag > spectrogram[frame][bin - 1] && mag > spectrogram[frame][bin + 1]) {
                        // In time: must be a crest OR at least 3 frames since last peak in this band
                        boolean isTimeCrest = (frame == 0 || mag >= spectrogram[frame - 1][bin])
                                && (frame == numFrames - 1 || mag >= spectrogram[frame + 1][bin]);
                        boolean isStrideReady = (frame - lastPeakFrameInBand[bandIdx] >= 3);

                        if (isTimeCrest || isStrideReady) {
                            if (mag > highestMagInBand) {
                                highestMagInBand = mag;
                                bestBinInBand = bin;
                            }
                        }
                    }
                }

                if (bestBinInBand != -1) {
                    frameCandidates.add(new SpectralPeak(bestBinInBand, frame, highestMagInBand));
                    lastPeakFrameInBand[bandIdx] = frame;
                }
            }

            // Cap the number of peaks per frame if too dense
            if (frameCandidates.size() > maxPeaksPerFrame) {
                frameCandidates.sort((a, b) -> Double.compare(b.magnitude(), a.magnitude()));
                frameCandidates = frameCandidates.subList(0, maxPeaksPerFrame);
            }

            allPeaks.addAll(frameCandidates);
        }

        Collections.sort(allPeaks);
        return allPeaks;
    }

    private boolean isLocalPeak(double[][] spectrogram, int targetFrame, int targetBin,
                                int numFrames, int numBins, double targetMag) {
        // Frequency check (must be strictly greater than adjacent bins)
        if (targetBin > 0 && spectrogram[targetFrame][targetBin - 1] >= targetMag) {
            return false;
        }
        if (targetBin < numBins - 1 && spectrogram[targetFrame][targetBin + 1] > targetMag) {
            return false;
        }

        // Time check (must be greater than adjacent frames, with tie breaking)
        if (targetFrame > 0 && spectrogram[targetFrame - 1][targetBin] >= targetMag) {
            return false;
        }
        if (targetFrame < numFrames - 1 && spectrogram[targetFrame + 1][targetBin] > targetMag) {
            return false;
        }

        return true;
    }

    private boolean isLocalMaximum(double[][] spectrogram, int targetFrame, int targetBin,
                                   int numFrames, int numBins, double targetMag) {
        int startFrame = Math.max(0, targetFrame - timeNeighborhood);
        int endFrame = Math.min(numFrames - 1, targetFrame + timeNeighborhood);
        int startBin = Math.max(0, targetBin - freqNeighborhood);
        int endBin = Math.min(numBins - 1, targetBin + freqNeighborhood);

        for (int f = startFrame; f <= endFrame; f++) {
            for (int b = startBin; b <= endBin; b++) {
                if (f == targetFrame && b == targetBin) {
                    continue;
                }
                // Break plateau ties strictly: prior coordinates require strict superiority
                if (f < targetFrame || (f == targetFrame && b < targetBin)) {
                    if (spectrogram[f][b] >= targetMag) {
                        return false;
                    }
                } else {
                    if (spectrogram[f][b] > targetMag) {
                        return false;
                    }
                }
            }
        }
        return true;
    }
}
