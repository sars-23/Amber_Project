package com.echotrace.audio;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class AudioDecoderService {

    private static final Logger log = LoggerFactory.getLogger(AudioDecoderService.class);

    private final AudioValidationService validationService;
    private final AudioNormalizer audioNormalizer;

    public AudioDecoderService(AudioValidationService validationService, AudioNormalizer audioNormalizer) {
        this.validationService = validationService;
        this.audioNormalizer = audioNormalizer;
    }

    /**
     * Validates raw input, normalizes to 11,025 Hz 16-bit mono PCM, and validates the resulting audio.
     */
    public PcmAudio decodeAndNormalize(byte[] audioBytes, String filenameHint) {
        validationService.validateRawUpload(audioBytes, filenameHint);

        long startTime = System.currentTimeMillis();
        PcmAudio pcm = audioNormalizer.normalize(audioBytes, filenameHint);
        long duration = System.currentTimeMillis() - startTime;

        validationService.validateDecodedAudio(pcm);

        log.info("Decoded audio '{}': {} samples, duration {}ms in {}ms",
                filenameHint, pcm.getSampleCount(), pcm.getDurationMs(), duration);

        return pcm;
    }
}
