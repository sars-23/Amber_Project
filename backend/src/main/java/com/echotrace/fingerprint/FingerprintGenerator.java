package com.echotrace.fingerprint;

import com.echotrace.audio.PcmAudio;
import com.echotrace.config.AudioProperties;
import com.echotrace.dsp.SpectralPeak;
import com.echotrace.dsp.SpectralPeakExtractor;
import com.echotrace.dsp.StftProcessor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.List;

/**
 * End-to-end audio fingerprint generator service.
 * Processes PCM audio into STFT spectrograms, extracts spectral peaks,
 * and builds combinatorial constellation hashes.
 */
@Service
public class FingerprintGenerator {

    private static final Logger log = LoggerFactory.getLogger(FingerprintGenerator.class);

    private final StftProcessor stftProcessor;
    private final SpectralPeakExtractor peakExtractor;
    private final ConstellationBuilder constellationBuilder;
    private final AudioProperties audioProperties;

    @org.springframework.beans.factory.annotation.Autowired
    public FingerprintGenerator(AudioProperties audioProperties,
                                SpectralPeakExtractor peakExtractor,
                                ConstellationBuilder constellationBuilder) {
        this.audioProperties = audioProperties;
        this.stftProcessor = new StftProcessor(1024, 512);
        this.peakExtractor = peakExtractor;
        this.constellationBuilder = constellationBuilder;
    }

    public FingerprintGenerator(StftProcessor stftProcessor,
                                SpectralPeakExtractor peakExtractor,
                                ConstellationBuilder constellationBuilder,
                                AudioProperties audioProperties) {
        this.stftProcessor = stftProcessor;
        this.peakExtractor = peakExtractor;
        this.constellationBuilder = constellationBuilder;
        this.audioProperties = audioProperties;
    }

    /**
     * Generates fingerprints from normalized PcmAudio.
     */
    public List<Fingerprint> generateFingerprints(PcmAudio pcmAudio) {
        if (pcmAudio == null || pcmAudio.getSampleCount() < stftProcessor.getFrameSize()) {
            return Collections.emptyList();
        }

        long startTime = System.nanoTime();

        // 1. STFT Spectrogram
        double[][] spectrogram = stftProcessor.computeSpectrogram(pcmAudio);

        // 2. Extract Spectral Peaks
        List<SpectralPeak> peaks = peakExtractor.extractPeaks(spectrogram);

        // 3. Build Constellation Fingerprints
        List<Fingerprint> fingerprints = constellationBuilder.buildFingerprints(
                peaks, pcmAudio.getSampleRate(), stftProcessor.getHopSize());

        long elapsedNanos = System.nanoTime() - startTime;
        double elapsedMs = elapsedNanos / 1_000_000.0;

        log.debug("Fingerprinted {} samples ({}ms) -> {} peaks, {} fingerprints in {:.2f}ms",
                pcmAudio.getSampleCount(), pcmAudio.getDurationMs(),
                peaks.size(), fingerprints.size(), elapsedMs);

        return fingerprints;
    }

    public StftProcessor getStftProcessor() {
        return stftProcessor;
    }
}
