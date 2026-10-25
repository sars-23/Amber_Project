package com.amber.dsp;

import java.util.Objects;

/**
 * An identified salient spectral peak in the time-frequency constellation plane.
 */
public record SpectralPeak(int frequencyBin, int frameIndex, double magnitude) implements Comparable<SpectralPeak> {

    public SpectralPeak {
        if (frequencyBin < 0) {
            throw new IllegalArgumentException("frequencyBin cannot be negative: " + frequencyBin);
        }
        if (frameIndex < 0) {
            throw new IllegalArgumentException("frameIndex cannot be negative: " + frameIndex);
        }
    }

    @Override
    public int compareTo(SpectralPeak other) {
        // Sort primarily by time (frameIndex), secondarily by frequencyBin
        int timeCompare = Integer.compare(this.frameIndex, other.frameIndex);
        if (timeCompare != 0) {
            return timeCompare;
        }
        return Integer.compare(this.frequencyBin, other.frequencyBin);
    }
}
