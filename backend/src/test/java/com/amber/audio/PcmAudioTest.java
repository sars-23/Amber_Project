package com.amber.audio;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PcmAudioTest {

    @Test
    @DisplayName("Should convert between shorts, doubles and little-endian bytes accurately")
    void testConversions() {
        short[] original = new short[]{0, 16384, -16384, 32767, -32768};
        PcmAudio pcm = new PcmAudio(original, 11025);

        assertThat(pcm.getSampleCount()).isEqualTo(5);
        assertThat(pcm.getSampleRate()).isEqualTo(11025);

        // Test toDoubleArray
        double[] doubles = pcm.toDoubleArray();
        assertThat(doubles).hasSize(5);
        assertThat(doubles[0]).isEqualTo(0.0);
        assertThat(doubles[1]).isCloseTo(0.5, org.assertj.core.data.Offset.offset(0.001));
        assertThat(doubles[2]).isCloseTo(-0.5, org.assertj.core.data.Offset.offset(0.001));

        // Test toByteArray and fromLittleEndianBytes roundtrip
        byte[] bytes = pcm.toByteArray();
        assertThat(bytes).hasSize(10);

        PcmAudio reconstructed = PcmAudio.fromLittleEndianBytes(bytes, 11025);
        assertThat(reconstructed.getSamples()).containsExactly(original);
        assertThat(reconstructed).isEqualTo(pcm);
    }

    @Test
    @DisplayName("Should correctly calculate duration in seconds and milliseconds")
    void testDurationCalculations() {
        short[] samples = new short[11025 * 2]; // 2 seconds at 11025 Hz
        PcmAudio pcm = new PcmAudio(samples, 11025);

        assertThat(pcm.getDurationSeconds()).isEqualTo(2.0);
        assertThat(pcm.getDurationMs()).isEqualTo(2000L);
    }

    @Test
    @DisplayName("Should correctly slice audio sub-clips")
    void testSlice() {
        short[] samples = new short[11025 * 3]; // 3 seconds
        for (int i = 0; i < samples.length; i++) {
            samples[i] = (short) (i % 1000);
        }
        PcmAudio pcm = new PcmAudio(samples, 11025);

        // Slice 1 second starting at offset 1 second (1000ms, length 1000ms)
        PcmAudio slice = pcm.slice(1000, 1000);
        assertThat(slice.getSampleCount()).isEqualTo(11025);
        assertThat(slice.getSamples()[0]).isEqualTo(samples[11025]);
    }

    @Test
    @DisplayName("Should throw on invalid arguments")
    void testInvalidArguments() {
        assertThatThrownBy(() -> new PcmAudio(new short[10], 0))
                .isInstanceOf(IllegalArgumentException.class);

        assertThatThrownBy(() -> PcmAudio.fromLittleEndianBytes(new byte[5], 11025))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
