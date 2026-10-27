package com.amber.benchmark;

import com.amber.audio.AudioDecoderService;
import com.amber.audio.PcmAudio;
import com.amber.benchmark.dto.BenchmarkResponse;
import com.amber.fingerprint.Fingerprint;
import com.amber.fingerprint.FingerprintGenerator;
import com.amber.matching.AudioMatchingService;
import com.amber.matching.OffsetHistogram;
import com.amber.util.SyntheticAudioGenerator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.Semaphore;

/**
 * Isolated, in-memory audio fingerprinting robustness benchmark service.
 * Executes controlled acoustic degradation tests without persisting or querying the database.
 */
@Service
public class RobustnessBenchmarkService {

    private static final Logger log = LoggerFactory.getLogger(RobustnessBenchmarkService.class);

    public static final int MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB limit
    public static final double MAX_DURATION_SECONDS = 30.0;          // 30 seconds max duration
    public static final int SAMPLE_RATE = 11025;

    // Rate-limiting / concurrency protection: at most 2 concurrent benchmarks
    private final Semaphore concurrencyLimiter = new Semaphore(2);

    private final AudioDecoderService audioDecoderService;
    private final FingerprintGenerator fingerprintGenerator;

    public RobustnessBenchmarkService(AudioDecoderService audioDecoderService,
                                     FingerprintGenerator fingerprintGenerator) {
        this.audioDecoderService = audioDecoderService;
        this.fingerprintGenerator = fingerprintGenerator;
    }

    /**
     * Executes an isolated in-memory robustness benchmark.
     *
     * @param audioBytes   Optional user-supplied reference audio bytes (null for built-in melody)
     * @param filenameHint Filename hint for audio decoder
     * @param snrDb        Signal-to-noise ratio in decibels (e.g. 0 to 30 dB)
     * @param offsetSecs   Target starting offset within reference audio
     * @param durationSecs Excerpt duration (typically 4.0s)
     * @return BenchmarkResponse containing detailed match results, ground truth comparison, and diagnostics
     */
    public BenchmarkResponse runBenchmark(byte[] audioBytes,
                                          String filenameHint,
                                          Double snrDb,
                                          Double offsetSecs,
                                          Double durationSecs) {
        return runBenchmark(audioBytes, filenameHint, null, null, snrDb, offsetSecs, durationSecs);
    }

    public BenchmarkResponse runBenchmark(byte[] audioBytes,
                                          String filenameHint,
                                          byte[] queryAudioBytes,
                                          String queryFilenameHint,
                                          Double snrDb,
                                          Double offsetSecs,
                                          Double durationSecs) {
        if (!concurrencyLimiter.tryAcquire()) {
            throw new IllegalStateException("The benchmark engine is currently at maximum capacity. Please retry shortly.");
        }

        long startTime = System.nanoTime();
        try {
            PcmAudio referencePcm;
            String referenceTitle;

            if (audioBytes == null || audioBytes.length == 0) {
                // Built-in 12-second benchmark symphony
                double[] notes = {261.63, 329.63, 392.00, 493.88, 523.25, 659.25, 783.99, 987.77, 880.00, 698.46, 587.33, 392.00};
                short[] melodySamples = SyntheticAudioGenerator.generateMelody(notes, 1.0, SAMPLE_RATE);
                referencePcm = new PcmAudio(melodySamples, SAMPLE_RATE);
                referenceTitle = "Benchmark Symphony (Built-in 12s Reference)";
            } else {
                if (audioBytes.length > MAX_FILE_SIZE_BYTES) {
                    throw new IllegalArgumentException("Reference audio file exceeds the 10 MB limit for in-memory benchmarks.");
                }

                referencePcm = audioDecoderService.decodeAndNormalize(audioBytes, filenameHint != null ? filenameHint : "reference.wav");

                if (referencePcm.getDurationSeconds() > MAX_DURATION_SECONDS) {
                    log.info("Truncating benchmark reference audio from {}s to {}s", referencePcm.getDurationSeconds(), MAX_DURATION_SECONDS);
                    referencePcm = referencePcm.slice(0L, (long) (MAX_DURATION_SECONDS * 1000));
                }

                referenceTitle = (filenameHint != null && !filenameHint.isBlank()) ? filenameHint : "User Reference Audio";
            }

            // 1. Generate reference fingerprints in-memory
            List<Fingerprint> refFingerprints = fingerprintGenerator.generateFingerprints(referencePcm);
            if (refFingerprints.isEmpty()) {
                double elapsed = (System.nanoTime() - startTime) / 1_000_000.0;
                return new BenchmarkResponse(
                        false, referenceTitle, snrDb != null ? snrDb : 30.0, 0, 0, 0, 0.0, 0.0,
                        0, 0, 0, elapsed, Collections.emptyList(),
                        "Reference audio does not contain recognizable harmonic peaks for constellation fingerprinting."
                );
            }

            // 2. Determine excerpt window and slice ground truth audio (or decode query audio)
            PcmAudio cleanExcerpt;
            int targetOffsetMs;

            if (queryAudioBytes != null && queryAudioBytes.length > 0) {
                cleanExcerpt = audioDecoderService.decodeAndNormalize(queryAudioBytes, queryFilenameHint != null ? queryFilenameHint : "query.wav");
                targetOffsetMs = -1; // External query
            } else {
                double excerptDuration = (durationSecs != null && durationSecs >= 1.0) ? Math.min(durationSecs, 10.0) : 4.0;
                double maxOffset = Math.max(0.0, referencePcm.getDurationSeconds() - excerptDuration);
                double safeOffset = (offsetSecs != null && offsetSecs >= 0.0) ? Math.min(offsetSecs, maxOffset) : Math.min(2.0, maxOffset);
                targetOffsetMs = (int) Math.round(safeOffset * 1000);
                cleanExcerpt = referencePcm.slice(targetOffsetMs, (long) (excerptDuration * 1000));
            }

            // 3. Apply Gaussian noise based on configured SNR
            double effectiveSnr = (snrDb != null && !Double.isNaN(snrDb)) ? snrDb : 20.0;
            short[] cleanSamples = cleanExcerpt.getSamples();
            short[] testSamples;

            if (Double.isInfinite(effectiveSnr) || effectiveSnr >= 60.0) {
                testSamples = cleanSamples.clone();
            } else {
                testSamples = addGaussianNoise(cleanSamples, effectiveSnr);
            }

            PcmAudio testPcm = new PcmAudio(testSamples, SAMPLE_RATE);

            // 4. Extract query fingerprints from the noisy excerpt
            List<Fingerprint> queryFingerprints = fingerprintGenerator.generateFingerprints(testPcm);

            // 5. In-memory time-coherent matching against reference fingerprints
            Map<Integer, List<Integer>> refTimesByHash = new HashMap<>();
            for (Fingerprint fp : refFingerprints) {
                refTimesByHash.computeIfAbsent(fp.hash(), k -> new ArrayList<>(2)).add(fp.anchorTimeMs());
            }

            OffsetHistogram histogram = new OffsetHistogram(1L);
            int matchedFingerprints = 0;

            for (Fingerprint qFp : queryFingerprints) {
                List<Integer> refTimes = refTimesByHash.get(qFp.hash());
                if (refTimes != null) {
                    matchedFingerprints++;
                    for (int refTime : refTimes) {
                        histogram.addVote(refTime - qFp.anchorTimeMs());
                    }
                }
            }

            int peakVotes = histogram.getPeakVotes();
            double score = histogram.calculateScore();
            int estimatedOffsetMs = Math.max(0, histogram.getPeakOffsetMs());
            int offsetErrorMs = Math.abs(estimatedOffsetMs - targetOffsetMs);

            boolean matched = peakVotes >= AudioMatchingService.MIN_PEAK_VOTES_THRESHOLD
                    && score >= AudioMatchingService.MIN_SCORE_THRESHOLD;

            double confidence = 0.0;
            if (matched) {
                confidence = Math.min(1.0, Math.max(0.0,
                        0.5 * ((double) peakVotes / Math.max(peakVotes, 30)) +
                        0.5 * Math.min(1.0, score / 10.0)));
            }

            double durationMs = (System.nanoTime() - startTime) / 1_000_000.0;

            String explanation;
            if (matched) {
                String noiseText = Double.isInfinite(effectiveSnr) ? "clean audio" : String.format("%+.1f dB SNR", effectiveSnr);
                explanation = String.format("Acoustic constellation survived %s with %d peak votes and %d ms offset error.",
                        noiseText, peakVotes, offsetErrorMs);
            } else {
                explanation = String.format("Severe acoustic degradation (%+.1f dB SNR) drowned spectral peaks below the detection threshold (%d peak votes, min required %d).",
                        effectiveSnr, peakVotes, AudioMatchingService.MIN_PEAK_VOTES_THRESHOLD);
            }

            return new BenchmarkResponse(
                    matched,
                    referenceTitle,
                    effectiveSnr,
                    targetOffsetMs,
                    estimatedOffsetMs,
                    offsetErrorMs,
                    Math.round(score * 10.0) / 10.0,
                    Math.round(confidence * 100.0) / 100.0,
                    matchedFingerprints,
                    queryFingerprints.size(),
                    refFingerprints.size(),
                    Math.round(durationMs * 10.0) / 10.0,
                    histogram.getTopBuckets(15),
                    explanation
            );
        } finally {
            concurrencyLimiter.release();
        }
    }

    /**
     * Adds additive white Gaussian noise to audio samples to achieve target SNR in decibels.
     */
    private short[] addGaussianNoise(short[] samples, double targetSnrDb) {
        if (samples.length == 0) return samples;

        double sumSquares = 0.0;
        for (short s : samples) {
            double norm = s / 32768.0;
            sumSquares += norm * norm;
        }
        double signalPower = sumSquares / samples.length;

        double noisePower = signalPower / Math.pow(10.0, targetSnrDb / 10.0);
        double noiseStdDev = Math.sqrt(noisePower);

        Random random = new Random(1337); // Deterministic seed for reproducible evaluation
        short[] noisy = new short[samples.length];

        for (int i = 0; i < samples.length; i++) {
            double cleanVal = samples[i] / 32768.0;
            double noise = random.nextGaussian() * noiseStdDev;
            double combined = cleanVal + noise;
            combined = Math.max(-1.0, Math.min(1.0, combined));
            noisy[i] = (short) Math.round(combined * 32767.0);
        }

        return noisy;
    }
}
