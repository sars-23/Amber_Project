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
    public static final int[][] DEFAULT_BANDS = new int[][]{
            {3, 10},     // 32 Hz - 108 Hz (Sub-bass / Bass)
            {11, 25},    // 118 Hz - 269 Hz (Low-mid)
            {26, 60},    // 280 Hz - 646 Hz (Mid-range, e.g. A4 at bin 41)
            {61, 130},   // 656 Hz - 1400 Hz (High-mid)
            {131, 280},  // 1410 Hz - 3015 Hz (Presence)
            {281, 511}   // 3025 Hz - 5500 Hz (Brilliance)
    };

    private final int[][] frequencyBands;
    private final double minPeakMagnitude;
    private final int timeNeighborhood;
    private final int freqNeighborhood;
    private final int maxPeaksPerFrame;

    public SpectralPeakExtractor() {
        this(DEFAULT_BANDS, 1.0, 2, 2, 8);
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

        for (int frame = 0; frame < numFrames; frame++) {
            List<SpectralPeak> frameCandidates = new ArrayList<>();

            for (int[] band : frequencyBands) {
                int minBin = Math.max(0, band[0]);
                int maxBin = Math.min(numBins - 1, band[1]);

                // Find local maximum in this band for the current frame
                double highestMagInBand = -1.0;
                int bestBinInBand = -1;

                for (int bin = minBin; bin <= maxBin; bin++) {
                    double mag = spectrogram[frame][bin];

                    if (mag < minPeakMagnitude) {
                        continue;
                    }

                    // Check local maximum condition across neighborhood (±timeNeighborhood, ±freqNeighborhood)
                    if (isLocalMaximum(spectrogram, frame, bin, numFrames, numBins, mag)) {
                        if (mag > highestMagInBand) {
                            highestMagInBand = mag;
                            bestBinInBand = bin;
                        }
                    }
                }

                if (bestBinInBand != -1) {
                    frameCandidates.add(new SpectralPeak(bestBinInBand, frame, highestMagInBand));
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
