package com.amber.audio;

import com.amber.config.AudioProperties;
import com.amber.exception.AudioValidationException;
import org.springframework.stereotype.Service;

@Service
public class AudioValidationService {

    private final AudioProperties audioProperties;

    public AudioValidationService(AudioProperties audioProperties) {
        this.audioProperties = audioProperties;
    }

    public void validateRawUpload(byte[] fileBytes, String filename) {
        if (fileBytes == null || fileBytes.length == 0) {
            throw new AudioValidationException("Uploaded audio file is empty.");
        }
        if (fileBytes.length > audioProperties.getMaxFileSizeBytes()) {
            throw new AudioValidationException(String.format(
                    "Uploaded audio file exceeds maximum allowed size of %d bytes (received %d bytes).",
                    audioProperties.getMaxFileSizeBytes(), fileBytes.length));
        }
        if (fileBytes.length < 12) {
            throw new AudioValidationException("Uploaded file is too small to contain valid audio data.");
        }
    }

    public void validateDecodedAudio(PcmAudio pcmAudio) {
        if (pcmAudio == null || pcmAudio.getSampleCount() == 0) {
            throw new AudioValidationException("Decoded audio stream contains zero samples.");
        }

        double duration = pcmAudio.getDurationSeconds();
        if (duration < audioProperties.getMinDurationSeconds()) {
            throw new AudioValidationException(String.format(
                    "Audio duration (%.2fs) is shorter than minimum required duration of %ds.",
                    duration, audioProperties.getMinDurationSeconds()));
        }

        if (duration > audioProperties.getMaxDurationSeconds()) {
            throw new AudioValidationException(String.format(
                    "Audio duration (%.2fs) exceeds maximum permitted duration of %ds.",
                    duration, audioProperties.getMaxDurationSeconds()));
        }

        // Check for complete silence
        double rms = calculateRms(pcmAudio.getSamples());
        if (rms < 1e-5) {
            throw new AudioValidationException("Decoded audio is completely silent (RMS energy < 1e-5).");
        }
    }

    private double calculateRms(short[] samples) {
        double sum = 0.0;
        for (short sample : samples) {
            double normalized = (double) sample / 32768.0;
            sum += normalized * normalized;
        }
        return Math.sqrt(sum / samples.length);
    }
}
