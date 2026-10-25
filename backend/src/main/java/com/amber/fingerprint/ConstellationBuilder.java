package com.amber.fingerprint;

import com.amber.dsp.SpectralPeak;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Pairs salient spectral peaks into combinatorial constellation hashes within a forward time window.
 */
@Component
public class ConstellationBuilder {

    private final int minDeltaFrames;
    private final int maxDeltaFrames;
    private final int maxTargetsPerAnchor;

    public ConstellationBuilder() {
        this(FingerprintHashCodec.MIN_FRAME_DELTA, FingerprintHashCodec.MAX_FRAME_DELTA, 5);
    }

    public ConstellationBuilder(int minDeltaFrames, int maxDeltaFrames, int maxTargetsPerAnchor) {
        if (minDeltaFrames < FingerprintHashCodec.MIN_FRAME_DELTA) {
            throw new IllegalArgumentException("minDeltaFrames must be >= " + FingerprintHashCodec.MIN_FRAME_DELTA);
        }
        if (maxDeltaFrames > FingerprintHashCodec.MAX_FRAME_DELTA) {
            throw new IllegalArgumentException("maxDeltaFrames must be <= " + FingerprintHashCodec.MAX_FRAME_DELTA);
        }
        if (minDeltaFrames > maxDeltaFrames) {
            throw new IllegalArgumentException("minDeltaFrames cannot exceed maxDeltaFrames");
        }
        this.minDeltaFrames = minDeltaFrames;
        this.maxDeltaFrames = maxDeltaFrames;
        this.maxTargetsPerAnchor = maxTargetsPerAnchor;
    }

    /**
     * Builds constellation fingerprints from a list of spectral peaks.
     *
     * @param peaks      Sorted list of spectral peaks
     * @param sampleRate Sampling rate (e.g. 11025)
     * @param hopSize    STFT hop size (e.g. 512)
     * @return List of Fingerprints
     */
    public List<Fingerprint> buildFingerprints(List<SpectralPeak> peaks, int sampleRate, int hopSize) {
        if (peaks == null || peaks.size() < 2) {
            return Collections.emptyList();
        }

        List<Fingerprint> fingerprints = new ArrayList<>();
        int numPeaks = peaks.size();

        for (int i = 0; i < numPeaks; i++) {
            SpectralPeak anchor = peaks.get(i);
            int anchorFrame = anchor.frameIndex();
            int anchorFreq = Math.min(FingerprintHashCodec.MAX_FREQ_BIN, anchor.frequencyBin());
            int anchorTimeMs = (int) Math.round(((double) anchorFrame * hopSize / sampleRate) * 1000.0);

            int targetsPaired = 0;

            for (int j = i + 1; j < numPeaks; j++) {
                SpectralPeak target = peaks.get(j);
                int targetFrame = target.frameIndex();
                int deltaFrames = targetFrame - anchorFrame;

                if (deltaFrames < minDeltaFrames) {
                    continue; // Skip peaks occurring in the same frame or too soon
                }

                if (deltaFrames > maxDeltaFrames) {
                    break; // Target window exceeded, since peaks are sorted by frameIndex
                }

                int targetFreq = Math.min(FingerprintHashCodec.MAX_FREQ_BIN, target.frequencyBin());
                int hash = FingerprintHashCodec.encode(anchorFreq, targetFreq, deltaFrames);

                fingerprints.add(new Fingerprint(hash, anchorTimeMs, anchorFrame, targetFrame));
                targetsPaired++;

                if (targetsPaired >= maxTargetsPerAnchor) {
                    break;
                }
            }
        }

        return fingerprints;
    }
}
