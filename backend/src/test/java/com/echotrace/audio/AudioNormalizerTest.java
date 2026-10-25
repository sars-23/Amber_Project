package com.echotrace.audio;

import com.echotrace.config.AudioProperties;
import com.echotrace.exception.AudioProcessingException;
import com.echotrace.util.SyntheticAudioGenerator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AudioNormalizerTest {

    private AudioNormalizer audioNormalizer;
    private AudioProperties properties;

    @BeforeEach
    void setUp() {
        properties = new AudioProperties();
        properties.setSampleRate(11025);
        properties.setFfmpegPath("C:/Users/rezsi/AppData/Local/Programs/Stremio/ffmpeg.exe");
        audioNormalizer = new AudioNormalizer(properties);
    }

    @Test
    @DisplayName("Should normalize 11025Hz WAV file directly")
    void testNormalizeWavDirect() throws IOException {
        short[] original = SyntheticAudioGenerator.generateSineSamples(440, 2.0, 11025, 0.8);
        byte[] wavBytes = SyntheticAudioGenerator.createWavFile(original, 11025);

        PcmAudio pcm = audioNormalizer.normalize(wavBytes, "test_11k.wav");

        assertThat(pcm).isNotNull();
        assertThat(pcm.getSampleRate()).isEqualTo(11025);
        assertThat(pcm.getSampleCount()).isEqualTo(original.length);
        assertThat(pcm.getSamples()).containsExactly(original);
    }

    @Test
    @DisplayName("Should resample 44100Hz WAV to 11025Hz via FFmpeg")
    void testResample44kTo11k() throws IOException {
        short[] original = SyntheticAudioGenerator.generateSineSamples(440, 1.5, 44100, 0.8);
        byte[] wavBytes = SyntheticAudioGenerator.createWavFile(original, 44100);

        PcmAudio pcm = audioNormalizer.normalize(wavBytes, "test_44k.wav");

        assertThat(pcm).isNotNull();
        assertThat(pcm.getSampleRate()).isEqualTo(11025);
        // 1.5 seconds at 11025 Hz ~ 16538 samples
        assertThat(pcm.getDurationSeconds()).isCloseTo(1.5, org.assertj.core.data.Offset.offset(0.05));
    }

    @Test
    @DisplayName("Should throw AudioProcessingException on invalid non-audio file bytes")
    void testMalformedAudio() {
        byte[] garbage = new byte[]{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15};
        assertThatThrownBy(() -> audioNormalizer.normalize(garbage, "corrupt.mp3"))
                .isInstanceOf(AudioProcessingException.class);
    }
}
