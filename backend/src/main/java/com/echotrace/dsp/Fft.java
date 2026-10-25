package com.echotrace.dsp;

/**
 * Pure Java in-place Radix-2 Cooley-Tukey Decimation-In-Time (DIT) Fast Fourier Transform.
 * Thread-safe: precomputes static twiddle factors and bit-reversal lookup tables
 * while operating on callers' provided arrays with zero shared mutable state.
 */
public final class Fft {

    private final int size;
    private final int log2Size;
    private final int[] bitReversal;
    private final double[] cosTable;
    private final double[] sinTable;

    public Fft(int size) {
        if (size <= 0 || (size & (size - 1)) != 0) {
            throw new IllegalArgumentException("FFT size must be a positive power of 2, received: " + size);
        }
        this.size = size;
        this.log2Size = Integer.numberOfTrailingZeros(size);
        this.bitReversal = precomputeBitReversal(size, log2Size);
        this.cosTable = new double[size / 2];
        this.sinTable = new double[size / 2];

        // Precompute twiddle factors W_N^k = cos(2*pi*k/N) - j*sin(2*pi*k/N)
        for (int k = 0; k < size / 2; k++) {
            double angle = -2.0 * Math.PI * k / size;
            cosTable[k] = Math.cos(angle);
            sinTable[k] = Math.sin(angle);
        }
    }

    private static int[] precomputeBitReversal(int n, int log2N) {
        int[] table = new int[n];
        for (int i = 0; i < n; i++) {
            table[i] = Integer.reverse(i) >>> (32 - log2N);
        }
        return table;
    }

    public int getSize() {
        return size;
    }

    /**
     * Executes in-place radix-2 DIT FFT.
     * real and imag must be of length equal to getSize().
     */
    public void transform(double[] real, double[] imag) {
        if (real.length != size || imag.length != size) {
            throw new IllegalArgumentException(String.format(
                    "Buffer length must equal FFT size %d, but got real=%d, imag=%d",
                    size, real.length, imag.length));
        }

        // 1. Bit-reversal permutation
        for (int i = 0; i < size; i++) {
            int j = bitReversal[i];
            if (i < j) {
                double tempReal = real[i];
                real[i] = real[j];
                real[j] = tempReal;

                double tempImag = imag[i];
                imag[i] = imag[j];
                imag[j] = tempImag;
            }
        }

        // 2. Cooley-Tukey butterfly stages
        for (int stage = 1; stage <= log2Size; stage++) {
            int halfLen = 1 << (stage - 1);
            int step = halfLen << 1;
            int tableStep = size / step;

            for (int k = 0; k < size; k += step) {
                for (int j = 0; j < halfLen; j++) {
                    int tableIndex = j * tableStep;
                    double twiddleReal = cosTable[tableIndex];
                    double twiddleImag = sinTable[tableIndex];

                    int uIndex = k + j;
                    int vIndex = k + j + halfLen;

                    double vReal = real[vIndex];
                    double vImag = imag[vIndex];

                    // Complex multiplication: (vReal + j*vImag) * (twiddleReal + j*twiddleImag)
                    double tReal = vReal * twiddleReal - vImag * twiddleImag;
                    double tImag = vReal * twiddleImag + vImag * twiddleReal;

                    double uReal = real[uIndex];
                    double uImag = imag[uIndex];

                    real[uIndex] = uReal + tReal;
                    imag[uIndex] = uImag + tImag;

                    real[vIndex] = uReal - tReal;
                    imag[vIndex] = uImag - tImag;
                }
            }
        }
    }

    /**
     * Computes single-sided magnitude spectrum for non-negative frequencies (bins 0 to N/2 inclusive).
     * Output length is (size / 2) + 1.
     */
    public double[] computeMagnitudeSpectrum(double[] real, double[] imag) {
        int halfSize = size / 2;
        double[] magnitudes = new double[halfSize + 1];

        // DC bin
        magnitudes[0] = Math.sqrt(real[0] * real[0] + imag[0] * imag[0]);

        // Positive frequency bins
        for (int i = 1; i < halfSize; i++) {
            magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
        }

        // Nyquist bin
        magnitudes[halfSize] = Math.sqrt(real[halfSize] * real[halfSize] + imag[halfSize] * imag[halfSize]);

        return magnitudes;
    }
}
