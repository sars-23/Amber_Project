package com.echotrace.util;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;

/**
 * Utility for generating deterministic synthetic PCM and WAV audio fixtures for tests.
 */
public final class SyntheticAudioGenerator {

    private SyntheticAudioGenerator() {}

    /**
     * Generates a 16-bit mono PCM sine wave array at the given sample rate.
     */
    public static short[] generateSineSamples(double frequencyHz, double durationSeconds, int sampleRate, double amplitude) {
        int totalSamples = (int) Math.round(durationSeconds * sampleRate);
        short[] samples = new short[totalSamples];
        double twoPiF = 2.0 * Math.PI * frequencyHz;

        for (int i = 0; i < totalSamples; i++) {
            double time = (double) i / sampleRate;
            double sampleValue = amplitude * Math.sin(twoPiF * time);
            samples[i] = (short) Math.round(Math.max(-1.0, Math.min(1.0, sampleValue)) * 32767.0);
        }
        return samples;
    }

    /**
     * Generates multi-tone chord samples.
     */
    public static short[] generateHarmonicChord(double[] frequenciesHz, double durationSeconds, int sampleRate) {
        int totalSamples = (int) Math.round(durationSeconds * sampleRate);
        short[] samples = new short[totalSamples];

        for (int i = 0; i < totalSamples; i++) {
            double time = (double) i / sampleRate;
            double sum = 0.0;
            for (double freq : frequenciesHz) {
                sum += Math.sin(2.0 * Math.PI * freq * time);
            }
            sum /= frequenciesHz.length;
            samples[i] = (short) Math.round(sum * 32767.0 * 0.85);
        }
        return samples;
    }

    /**
     * Generates a melody of successive tones over time.
     * This creates realistic non-stationary frequency content with precise temporal landmarks.
     */
    public static short[] generateMelody(double[] noteFrequenciesHz, double noteDurationSeconds, int sampleRate) {
        int samplesPerNote = (int) Math.round(noteDurationSeconds * sampleRate);
        int totalSamples = samplesPerNote * noteFrequenciesHz.length;
        short[] samples = new short[totalSamples];

        for (int noteIdx = 0; noteIdx < noteFrequenciesHz.length; noteIdx++) {
            double rootFreq = noteFrequenciesHz[noteIdx];
            int noteStart = noteIdx * samplesPerNote;
            // Generate root + major third (1.25x) + fifth (1.5x) for a rich musical chord
            double f1 = rootFreq;
            double f2 = rootFreq * 1.25;
            double f3 = rootFreq * 1.5;

            for (int i = 0; i < samplesPerNote; i++) {
                double time = (double) i / sampleRate;
                double noteTime = (double) i / samplesPerNote;
                // Mild natural decay
                double env = 0.5 + 0.5 * Math.exp(-1.5 * noteTime);

                double v1 = Math.sin(2.0 * Math.PI * f1 * time);
                double v2 = 0.8 * Math.sin(2.0 * Math.PI * f2 * time);
                double v3 = 0.7 * Math.sin(2.0 * Math.PI * f3 * time);
                double vHarmonic = 0.4 * Math.sin(4.0 * Math.PI * f1 * time);

                double combined = (v1 + v2 + v3 + vHarmonic) / 2.9 * env;
                samples[noteStart + i] = (short) Math.round(combined * 32767.0 * 0.9);
            }
        }
        return samples;
    }

    /**
     * Creates a valid canonical 16-bit mono RIFF/WAVE byte array.
     */
    public static byte[] createWavFile(short[] samples, int sampleRate) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        DataOutputStream dos = new DataOutputStream(baos);

        int subChunk2Size = samples.length * 2;
        int chunkSize = 36 + subChunk2Size;

        // RIFF header
        dos.writeBytes("RIFF");
        dos.writeInt(Integer.reverseBytes(chunkSize));
        dos.writeBytes("WAVE");

        // "fmt " sub-chunk
        dos.writeBytes("fmt ");
        dos.writeInt(Integer.reverseBytes(16)); // SubChunk1Size (16 for PCM)
        dos.writeShort(Short.reverseBytes((short) 1)); // AudioFormat (1 = PCM)
        dos.writeShort(Short.reverseBytes((short) 1)); // NumChannels (1 = Mono)
        dos.writeInt(Integer.reverseBytes(sampleRate)); // SampleRate
        dos.writeInt(Integer.reverseBytes(sampleRate * 2)); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
        dos.writeShort(Short.reverseBytes((short) 2)); // BlockAlign (NumChannels * BitsPerSample/8)
        dos.writeShort(Short.reverseBytes((short) 16)); // BitsPerSample

        // "data" sub-chunk
        dos.writeBytes("data");
        dos.writeInt(Integer.reverseBytes(subChunk2Size));
        for (short sample : samples) {
            dos.writeShort(Short.reverseBytes(sample));
        }

        dos.flush();
        return baos.toByteArray();
    }
}
