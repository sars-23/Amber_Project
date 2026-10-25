package com.echotrace.audio;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;
import java.util.Objects;

/**
 * Immutable domain representation of normalized mono PCM audio.
 * Samples are signed 16-bit integers stored in little-endian order.
 */
public final class PcmAudio {

    private final short[] samples;
    private final int sampleRate;

    public PcmAudio(short[] samples, int sampleRate) {
        if (sampleRate <= 0) {
            throw new IllegalArgumentException("Sample rate must be positive: " + sampleRate);
        }
        this.samples = Objects.requireNonNull(samples, "Samples array must not be null");
        this.sampleRate = sampleRate;
    }

    public static PcmAudio fromLittleEndianBytes(byte[] bytes, int sampleRate) {
        Objects.requireNonNull(bytes, "Byte buffer cannot be null");
        if (bytes.length % 2 != 0) {
            throw new IllegalArgumentException("Byte array length must be even for 16-bit PCM: " + bytes.length);
        }
        int numSamples = bytes.length / 2;
        short[] samples = new short[numSamples];
        ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples);
        return new PcmAudio(samples, sampleRate);
    }

    public static PcmAudio fromDoubles(double[] normalizedSamples, int sampleRate) {
        Objects.requireNonNull(normalizedSamples, "Samples array cannot be null");
        short[] samples = new short[normalizedSamples.length];
        for (int i = 0; i < normalizedSamples.length; i++) {
            double clamped = Math.max(-1.0, Math.min(1.0, normalizedSamples[i]));
            samples[i] = (short) Math.round(clamped * 32767.0);
        }
        return new PcmAudio(samples, sampleRate);
    }

    public short[] getSamples() {
        return samples;
    }

    public int getSampleRate() {
        return sampleRate;
    }

    public int getSampleCount() {
        return samples.length;
    }

    public double getDurationSeconds() {
        return (double) samples.length / sampleRate;
    }

    public long getDurationMs() {
        return Math.round(((double) samples.length / sampleRate) * 1000.0);
    }

    /**
     * Converts signed 16-bit PCM samples to double values in the range [-1.0, 1.0]
     * for mathematical DSP algorithms.
     */
    public double[] toDoubleArray() {
        double[] doubles = new double[samples.length];
        for (int i = 0; i < samples.length; i++) {
            doubles[i] = (double) samples[i] / 32768.0;
        }
        return doubles;
    }

    /**
     * Exports raw signed 16-bit little-endian byte array.
     */
    public byte[] toByteArray() {
        byte[] bytes = new byte[samples.length * 2];
        ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(samples);
        return bytes;
    }

    /**
     * Extracts a sub-clip from this PCM audio given start and length in milliseconds.
     */
    public PcmAudio slice(long startOffsetMs, long lengthMs) {
        int startIndex = (int) Math.round((startOffsetMs / 1000.0) * sampleRate);
        int sampleCount = (int) Math.round((lengthMs / 1000.0) * sampleRate);

        if (startIndex < 0 || startIndex >= samples.length) {
            throw new IllegalArgumentException("Start index out of bounds: " + startIndex);
        }
        int endIndex = Math.min(samples.length, startIndex + sampleCount);
        short[] sliced = Arrays.copyOfRange(samples, startIndex, endIndex);
        return new PcmAudio(sliced, sampleRate);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        PcmAudio pcmAudio = (PcmAudio) o;
        return sampleRate == pcmAudio.sampleRate && Arrays.equals(samples, pcmAudio.samples);
    }

    @Override
    public int hashCode() {
        int result = Objects.hash(sampleRate);
        result = 31 * result + Arrays.hashCode(samples);
        return result;
    }

    @Override
    public String toString() {
        return "PcmAudio{" +
                "sampleCount=" + samples.length +
                ", sampleRate=" + sampleRate +
                ", duration=" + String.format("%.2fs", getDurationSeconds()) +
                '}';
    }
}
