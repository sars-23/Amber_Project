package com.amber.audio;

import com.amber.config.AudioProperties;
import com.amber.exception.AudioValidationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AudioValidationServiceTest {

    private AudioValidationService validationService;
    private AudioProperties properties;

    @BeforeEach
    void setUp() {
        properties = new AudioProperties();
        properties.setMaxFileSizeBytes(1000);
        properties.setMinDurationSeconds(1);
        properties.setMaxDurationSeconds(10);
        validationService = new AudioValidationService(properties);
    }

    @Test
    @DisplayName("Should validate raw upload and reject empty or oversized files")
    void testValidateRawUpload() {
        assertThatThrownBy(() -> validationService.validateRawUpload(null, "test.wav"))
                .isInstanceOf(AudioValidationException.class)
                .hasMessageContaining("empty");

        assertThatThrownBy(() -> validationService.validateRawUpload(new byte[0], "test.wav"))
                .isInstanceOf(AudioValidationException.class)
                .hasMessageContaining("empty");

        assertThatThrownBy(() -> validationService.validateRawUpload(new byte[1500], "test.wav"))
                .isInstanceOf(AudioValidationException.class)
                .hasMessageContaining("exceeds maximum allowed size");

        assertThatCode(() -> validationService.validateRawUpload(new byte[200], "test.wav"))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("Should validate decoded audio duration and reject silent audio")
    void testValidateDecodedAudio() {
        // Too short (< 1s)
        short[] shortSamples = new short[5000]; // ~0.45s at 11025
        PcmAudio shortPcm = new PcmAudio(shortSamples, 11025);
        assertThatThrownBy(() -> validationService.validateDecodedAudio(shortPcm))
                .isInstanceOf(AudioValidationException.class)
                .hasMessageContaining("shorter than minimum");

        // Silent audio
        short[] silentSamples = new short[11025 * 2]; // 2s of zeroes
        PcmAudio silentPcm = new PcmAudio(silentSamples, 11025);
        assertThatThrownBy(() -> validationService.validateDecodedAudio(silentPcm))
                .isInstanceOf(AudioValidationException.class)
                .hasMessageContaining("completely silent");

        // Valid audio
        short[] validSamples = new short[11025 * 2];
        for (int i = 0; i < validSamples.length; i++) {
            validSamples[i] = (short) (Math.sin(2 * Math.PI * 440 * i / 11025) * 16000);
        }
        PcmAudio validPcm = new PcmAudio(validSamples, 11025);
        assertThatCode(() -> validationService.validateDecodedAudio(validPcm))
                .doesNotThrowAnyException();
    }
}
