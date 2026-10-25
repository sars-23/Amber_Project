package com.echotrace.audio;

import com.echotrace.config.AudioProperties;
import com.echotrace.util.SyntheticAudioGenerator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;

class AudioDecoderServiceTest {

    private AudioDecoderService audioDecoderService;

    @BeforeEach
    void setUp() {
        AudioProperties properties = new AudioProperties();
        properties.setSampleRate(11025);
        properties.setFfmpegPath("C:/Users/rezsi/AppData/Local/Programs/Stremio/ffmpeg.exe");
        properties.setMinDurationSeconds(1);
        properties.setMaxDurationSeconds(600);

        AudioValidationService validationService = new AudioValidationService(properties);
        AudioNormalizer normalizer = new AudioNormalizer(properties);
        audioDecoderService = new AudioDecoderService(validationService, normalizer);
    }

    @Test
    @DisplayName("Should validate and decode valid synthetic audio")
    void testValidAudioDecoding() throws IOException {
        short[] samples = SyntheticAudioGenerator.generateSineSamples(440.0, 2.0, 11025, 0.7);
        byte[] wav = SyntheticAudioGenerator.createWavFile(samples, 11025);

        PcmAudio pcm = audioDecoderService.decodeAndNormalize(wav, "sine440.wav");

        assertThat(pcm).isNotNull();
        assertThat(pcm.getSampleRate()).isEqualTo(11025);
        assertThat(pcm.getDurationSeconds()).isCloseTo(2.0, org.assertj.core.data.Offset.offset(0.01));
    }
}
