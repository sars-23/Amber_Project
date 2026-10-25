package com.echotrace.matching;

import com.echotrace.audio.AudioDecoderService;
import com.echotrace.audio.PcmAudio;
import com.echotrace.fingerprint.Fingerprint;
import com.echotrace.fingerprint.FingerprintGenerator;
import com.echotrace.indexing.FingerprintRepository;
import com.echotrace.indexing.IndexedFingerprint;
import com.echotrace.song.Song;
import com.echotrace.song.SongRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.DoubleAdder;

@Service
public class AudioMatchingService {

    private static final Logger log = LoggerFactory.getLogger(AudioMatchingService.class);

    // Minimum votes in the dominant offset bucket required to claim a genuine match
    public static final int MIN_PEAK_VOTES_THRESHOLD = 2;
    // Minimum coherence score required
    public static final double MIN_SCORE_THRESHOLD = 2.0;

    private final FingerprintRepository fingerprintRepository;
    private final SongRepository songRepository;
    private final AudioDecoderService audioDecoderService;
    private final FingerprintGenerator fingerprintGenerator;

    // Observability counters
    private final AtomicLong totalSearches = new AtomicLong(0);
    private final DoubleAdder totalSearchTimeMs = new DoubleAdder();

    public AudioMatchingService(FingerprintRepository fingerprintRepository,
                                SongRepository songRepository,
                                AudioDecoderService audioDecoderService,
                                FingerprintGenerator fingerprintGenerator) {
        this.fingerprintRepository = fingerprintRepository;
        this.songRepository = songRepository;
        this.audioDecoderService = audioDecoderService;
        this.fingerprintGenerator = fingerprintGenerator;
    }

    /**
     * Matches raw uploaded audio excerpt bytes.
     */
    public MatchResult matchAudio(byte[] audioBytes, String filenameHint) {
        PcmAudio pcm = audioDecoderService.decodeAndNormalize(audioBytes, filenameHint);
        return matchPcm(pcm);
    }

    /**
     * Matches normalized PCM audio.
     */
    public MatchResult matchPcm(PcmAudio pcmAudio) {
        List<Fingerprint> queryFingerprints = fingerprintGenerator.generateFingerprints(pcmAudio);
        return matchFingerprints(queryFingerprints);
    }

    /**
     * Matches a collection of query fingerprints against the indexed database.
     */
    public MatchResult matchFingerprints(List<Fingerprint> queryFingerprints) {
        long startTime = System.nanoTime();

        if (queryFingerprints == null || queryFingerprints.isEmpty()) {
            double duration = (System.nanoTime() - startTime) / 1_000_000.0;
            recordSearchMetrics(duration);
            return MatchResult.noMatch(0, duration);
        }

        // 1. Group query anchor timestamps by hash
        Map<Integer, List<Integer>> queryTimesByHash = new HashMap<>();
        for (Fingerprint fp : queryFingerprints) {
            queryTimesByHash.computeIfAbsent(fp.hash(), k -> new ArrayList<>(2)).add(fp.anchorTimeMs());
        }

        // 2. Fetch candidate fingerprints from database
        List<IndexedFingerprint> candidates = fingerprintRepository.findCandidatesByHashes(queryTimesByHash.keySet());

        if (candidates.isEmpty()) {
            double duration = (System.nanoTime() - startTime) / 1_000_000.0;
            recordSearchMetrics(duration);
            return MatchResult.noMatch(queryFingerprints.size(), duration);
        }

        // 3. Accumulate offset histogram votes per candidate song
        Map<Long, OffsetHistogram> histograms = new HashMap<>();
        for (IndexedFingerprint candidate : candidates) {
            List<Integer> queryTimes = queryTimesByHash.get(candidate.hash());
            if (queryTimes != null) {
                OffsetHistogram histogram = histograms.computeIfAbsent(
                        candidate.songId(),
                        id -> new OffsetHistogram(id)
                );
                for (int qTime : queryTimes) {
                    histogram.addVote(candidate.anchorTimeMs() - qTime);
                }
            }
        }

        // 4. Rank candidates by time-coherent score
        List<OffsetHistogram> ranked = histograms.values().stream()
                .sorted((a, b) -> Double.compare(b.calculateScore(), a.calculateScore()))
                .toList();

        double durationMs = (System.nanoTime() - startTime) / 1_000_000.0;
        recordSearchMetrics(durationMs);

        if (ranked.isEmpty()) {
            return MatchResult.noMatch(queryFingerprints.size(), durationMs);
        }

        OffsetHistogram winner = ranked.get(0);
        double winnerScore = winner.calculateScore();
        int winnerPeakVotes = winner.getPeakVotes();

        log.info("Match evaluation: queryFPs={}, candidates={}, histograms={}, winnerSongId={}, peakVotes={}, score={}",
                queryFingerprints.size(), candidates.size(), histograms.size(),
                winner != null ? winner.getSongId() : "none",
                winner != null ? winner.getPeakVotes() : 0,
                winner != null ? winner.calculateScore() : 0.0);

        // Check if winning candidate meets minimum confidence criteria
        if (winnerPeakVotes < MIN_PEAK_VOTES_THRESHOLD || winnerScore < MIN_SCORE_THRESHOLD) {
            log.warn("No match: candidate songId={} peakVotes={} score={:.2f} below threshold (minVotes={}, minScore={})",
                    winner.getSongId(), winnerPeakVotes, winnerScore, MIN_PEAK_VOTES_THRESHOLD, MIN_SCORE_THRESHOLD);
            return MatchResult.noMatch(queryFingerprints.size(), durationMs);
        }

        // Calculate separation margin over runner-up (if any)
        double margin = 1.0;
        if (ranked.size() > 1) {
            double secondScore = ranked.get(1).calculateScore();
            margin = (winnerScore - secondScore) / (winnerScore + 1.0);
        }

        double confidence = Math.min(1.0, Math.max(0.0,
                0.5 * ((double) winnerPeakVotes / Math.max(winnerPeakVotes, 30)) +
                0.5 * Math.max(0.0, margin)));

        Optional<Song> songOpt = songRepository.findById(winner.getSongId());
        if (songOpt.isEmpty()) {
            return MatchResult.noMatch(queryFingerprints.size(), durationMs);
        }

        Song song = songOpt.get();
        int estimatedOffsetMs = Math.max(0, winner.getPeakOffsetMs());

        log.info("MATCH FOUND: '{}' by '{}' at offset {}ms (votes={}, score={:.2f}, conf={:.2f}) in {:.2f}ms",
                song.title(), song.artist(), estimatedOffsetMs, winnerPeakVotes, winnerScore, confidence, durationMs);

        return new MatchResult(
                true,
                song,
                estimatedOffsetMs,
                Math.round(winnerScore * 10.0) / 10.0,
                Math.round(confidence * 100.0) / 100.0,
                winner.getTotalMatches(),
                queryFingerprints.size(),
                Math.round(durationMs * 10.0) / 10.0,
                winner.getTopBuckets(15)
        );
    }

    private void recordSearchMetrics(double durationMs) {
        totalSearches.incrementAndGet();
        totalSearchTimeMs.add(durationMs);
    }

    public long getTotalSearches() {
        return totalSearches.get();
    }

    public double getAverageSearchLatencyMs() {
        long count = totalSearches.get();
        return count > 0 ? (totalSearchTimeMs.sum() / count) : 0.0;
    }
}
