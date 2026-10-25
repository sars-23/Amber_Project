package com.echotrace.dsp;

/**
 * Precomputed Hann (Hanning) window function.
 * Formula: w(n) = 0.5 * (1 - cos(2 * PI * n / (N - 1)))
 */
public final class HannWindow {

    private final int size;
    private final double[] coefficients;

    public HannWindow(int size) {
        if (size <= 1) {
            throw new IllegalArgumentException("Window size must be greater than 1, received: " + size);
        }
        this.size = size;
        this.coefficients = new double[size];

        for (int n = 0; n < size; n++) {
            coefficients[n] = 0.5 * (1.0 - Math.cos(2.0 * Math.PI * n / (size - 1)));
        }
    }

    public int getSize() {
        return size;
    }

    public double[] getCoefficients() {
        return coefficients;
    }

    /**
     * Applies the Hann window in-place to the input array.
     */
    public void applyInPlace(double[] buffer) {
        if (buffer.length != size) {
            throw new IllegalArgumentException(String.format("Buffer length (%d) does not match window size (%d)", buffer.length, size));
        }
        for (int i = 0; i < size; i++) {
            buffer[i] *= coefficients[i];
        }
    }

    /**
     * Applies the Hann window to input samples, writing the windowed result to the destination buffer.
     */
    public void apply(double[] input, int offset, double[] destination) {
        if (destination.length < size) {
            throw new IllegalArgumentException("Destination buffer too small: " + destination.length);
        }
        for (int i = 0; i < size; i++) {
            destination[i] = input[offset + i] * coefficients[i];
        }
    }
}
