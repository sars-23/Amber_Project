package com.amber.matching;

import com.amber.audio.AudioDecoderService;
import com.amber.audio.PcmAudio;
import com.amber.fingerprint.Fingerprint;
import com.amber.fingerprint.FingerprintGenerator;
import com.amber.indexing.FingerprintRepository;
import com.amber.indexing.IndexedFingerprint;
import com.amber.song.Song;
import com.amber.song.SongRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.DoubleAdder;

@Service
public class AudioMatchingService {

    private static final Logger log = LoggerFactory.getLogger(AudioMatchingService.class);

    // Multi-factor recognition thresholds
    // Minimum votes in the dominant offset bucket required to claim a genuine match
    public static final int MIN_PEAK_VOTES_THRESHOLD = 4;
    // Minimum time-coherent score required
    public static final double MIN_SCORE_THRESHOLD = 3.0;
    // Minimum fraction of candidate's total hash hits concentrated in the dominant peak bucket
    public static final double MIN_COHERENCE_RATIO_THRESHOLD = 0.05;
    // Minimum composite confidence required to identify a song
    public static final double MIN_CONFIDENCE_THRESHOLD = 0.35;
    // Minimum relative separation margin required between winner and non-trivial runner-up
    public static final double MIN_AMBIGUITY_MARGIN_THRESHOLD = 0.15;
    // Minimum query fingerprints required to perform recognition
    public static final int MIN_QUERY_FINGERPRINTS = 10;

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

        if (queryFingerprints == null || queryFingerprints.size() < MIN_QUERY_FINGERPRINTS) {
            double duration = (System.nanoTime() - startTime) / 1_000_000.0;
            recordSearchMetrics(duration);
            int count = queryFingerprints == null ? 0 : queryFingerprints.size();
            MatchDiagnostics diag = new MatchDiagnostics(
                    count, 0, 0, 0, null, null, null, 0.0, 0, 0, 0, 0.0, 0.0, 0.0, 0,
                    "INSUFFICIENT_FEATURES", "Insufficient audio features detected in query excerpt.",
                    Math.round(duration * 10.0) / 10.0, Collections.emptyList()
            );
            return MatchResult.noMatch(count, duration, "Insufficient audio features detected in query excerpt.", diag);
        }

        // 1. Group query anchor timestamps by hash (deduplicate identical timestamps for the same hash)
        Map<Integer, Set<Integer>> queryTimesByHash = new HashMap<>();
        for (Fingerprint fp : queryFingerprints) {
            queryTimesByHash.computeIfAbsent(fp.hash(), k -> new LinkedHashSet<>(2)).add(fp.anchorTimeMs());
        }

        // 2. Fetch candidate fingerprints from database and deduplicate exact duplicate rows
        List<IndexedFingerprint> rawCandidates = fingerprintRepository.findCandidatesByHashes(queryTimesByHash.keySet());
        Set<IndexedFingerprint> candidates = new LinkedHashSet<>(rawCandidates);

        if (candidates.isEmpty()) {
            double duration = (System.nanoTime() - startTime) / 1_000_000.0;
            recordSearchMetrics(duration);
            MatchDiagnostics diag = new MatchDiagnostics(
                    queryFingerprints.size(), queryTimesByHash.size(), 0, 0,
                    null, null, null, 0.0, 0, 0, 0, 0.0, 0.0, 0.0, 0,
                    "NO_CANDIDATES", "No matching audio fingerprints found in the catalogue.",
                    Math.round(duration * 10.0) / 10.0, Collections.emptyList()
            );
            return MatchResult.noMatch(queryFingerprints.size(), duration, "No matching audio fingerprints found in the catalogue.", diag);
        }

        // 3. Accumulate offset histogram votes per candidate song using independent query coordinates
        Map<Long, OffsetHistogram> histograms = new HashMap<>();
        for (IndexedFingerprint candidate : candidates) {
            Set<Integer> queryTimes = queryTimesByHash.get(candidate.hash());
            if (queryTimes != null) {
                OffsetHistogram histogram = histograms.computeIfAbsent(
                        candidate.songId(),
                        id -> new OffsetHistogram(id)
                );
                for (int qTime : queryTimes) {
                    histogram.addMatch(candidate.anchorTimeMs() - qTime, candidate.hash(), qTime);
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
            MatchDiagnostics diag = new MatchDiagnostics(
                    queryFingerprints.size(), queryTimesByHash.size(), candidates.size(), 0,
                    null, null, null, 0.0, 0, 0, 0, 0.0, 0.0, 0.0, 0,
                    "NO_CANDIDATE_SONGS", "No candidate songs matched the query audio.",
                    Math.round(durationMs * 10.0) / 10.0, Collections.emptyList()
            );
            return MatchResult.noMatch(queryFingerprints.size(), durationMs, "No candidate songs matched the query audio.", diag);
        }

        OffsetHistogram winner = ranked.get(0);
        double winnerScore = winner.calculateScore();
        int winnerPeakVotes = winner.getPeakVotes();
        int totalWinnerVotes = winner.getTotalMatches();
        double coherenceRatio = totalWinnerVotes > 0 ? (double) winnerPeakVotes / totalWinnerVotes : 0.0;

        // Calculate runner-up comparison and separation margin
        double secondScore = 0.0;
        double margin;
        if (ranked.size() > 1) {
            secondScore = ranked.get(1).calculateScore();
            // Relative separation between 1st and 2nd candidate
            margin = (winnerScore - secondScore) / Math.max(winnerScore, 1.0);
        } else {
            // Single candidate: conservative margin based on signal prominence, never 1.0
            double internalScoreRatio = Math.min(1.0, winnerScore / 10.0);
            margin = Math.min(0.88, 0.50 + 0.38 * internalScoreRatio);
        }
        margin = Math.max(0.0, margin);

        // Calculate candidate confidence BEFORE acceptance decision
        double peakRatio = Math.min(1.0, (double) winnerPeakVotes / 30.0);
        double marginWeight = Math.min(1.0, margin);
        double rawConfidence = 0.50 * peakRatio + 0.50 * marginWeight;
        double confidence = Math.min(1.0, Math.max(0.0, rawConfidence));
        double roundedConfidence = Math.round(confidence * 100.0) / 100.0;
        double roundedScore = Math.round(winnerScore * 10.0) / 10.0;

        log.info("Match evaluation: queryFPs={}, candidates={}, histograms={}, winnerSongId={}, peakVotes={}, score={:.2f}, coherence={:.3f}, margin={:.3f}, conf={:.2f}",
                queryFingerprints.size(), candidates.size(), histograms.size(),
                winner.getSongId(), winnerPeakVotes, winnerScore, coherenceRatio, margin, confidence);

        // Gate 1: Check minimum peak votes
        if (winnerPeakVotes < MIN_PEAK_VOTES_THRESHOLD) {
            log.warn("Match rejected: candidate songId={} peakVotes={} below threshold {}",
                    winner.getSongId(), winnerPeakVotes, MIN_PEAK_VOTES_THRESHOLD);
            MatchDiagnostics diag = buildDiagnostics(
                    queryFingerprints.size(), queryTimesByHash.size(), candidates.size(), histograms.size(),
                    winner, secondScore, margin, "GATE_1_PEAK_VOTES",
                    "Insufficient time-coherent votes in peak offset bucket.", durationMs
            );
            return MatchResult.noMatchWithDiagnostics(
                    queryFingerprints.size(), durationMs, roundedScore, roundedConfidence,
                    totalWinnerVotes, winner.getTopBuckets(15),
                    "Insufficient time-coherent votes in peak offset bucket.", diag
            );
        }

        // Gate 2: Check coherence score
        if (winnerScore < MIN_SCORE_THRESHOLD) {
            log.warn("Match rejected: candidate songId={} score={:.2f} below threshold {:.2f}",
                    winner.getSongId(), winnerScore, MIN_SCORE_THRESHOLD);
            MatchDiagnostics diag = buildDiagnostics(
                    queryFingerprints.size(), queryTimesByHash.size(), candidates.size(), histograms.size(),
                    winner, secondScore, margin, "GATE_2_SCORE",
                    "Offset-histogram coherence score below recognition threshold.", durationMs
            );
            return MatchResult.noMatchWithDiagnostics(
                    queryFingerprints.size(), durationMs, roundedScore, roundedConfidence,
                    totalWinnerVotes, winner.getTopBuckets(15),
                    "Offset-histogram coherence score below recognition threshold.", diag
            );
        }

        // Gate 3: Check coherence ratio (reject random background hash collisions)
        if (coherenceRatio < MIN_COHERENCE_RATIO_THRESHOLD) {
            log.warn("Match rejected: candidate songId={} coherenceRatio={:.4f} below threshold {:.2f} (scattered noise)",
                    winner.getSongId(), coherenceRatio, MIN_COHERENCE_RATIO_THRESHOLD);
            MatchDiagnostics diag = buildDiagnostics(
                    queryFingerprints.size(), queryTimesByHash.size(), candidates.size(), histograms.size(),
                    winner, secondScore, margin, "GATE_3_COHERENCE_RATIO",
                    "Offset histogram scatter indicates random background hash collisions.", durationMs
            );
            return MatchResult.noMatchWithDiagnostics(
                    queryFingerprints.size(), durationMs, roundedScore, roundedConfidence,
                    totalWinnerVotes, winner.getTopBuckets(15),
                    "Offset histogram scatter indicates random background hash collisions.", diag
            );
        }

        // Gate 4: Candidate ambiguity check (winner barely beats runner-up)
        if (ranked.size() > 1 && secondScore >= 2.0 && margin < MIN_AMBIGUITY_MARGIN_THRESHOLD) {
            log.warn("Match rejected: ambiguous candidates song1={} (score={:.2f}) vs song2={} (score={:.2f}), margin={:.3f}",
                    winner.getSongId(), winnerScore, ranked.get(1).getSongId(), secondScore, margin);
            MatchDiagnostics diag = buildDiagnostics(
                    queryFingerprints.size(), queryTimesByHash.size(), candidates.size(), histograms.size(),
                    winner, secondScore, margin, "GATE_4_AMBIGUITY",
                    "Ambiguous match: Multiple candidate songs exhibited comparable acoustic correlation.", durationMs
            );
            return MatchResult.noMatchWithDiagnostics(
                    queryFingerprints.size(), durationMs, roundedScore, roundedConfidence,
                    totalWinnerVotes, winner.getTopBuckets(15),
                    "Ambiguous match: Multiple candidate songs exhibited comparable acoustic correlation.", diag
            );
        }

        // Gate 5: Candidate confidence check
        if (confidence < MIN_CONFIDENCE_THRESHOLD) {
            log.warn("Match rejected: candidate songId={} confidence={:.2f} below threshold {:.2f}",
                    winner.getSongId(), confidence, MIN_CONFIDENCE_THRESHOLD);
            String reason = String.format("Candidate acoustic confidence (%.1f%%) is below acceptance threshold.", roundedConfidence * 100.0);
            MatchDiagnostics diag = buildDiagnostics(
                    queryFingerprints.size(), queryTimesByHash.size(), candidates.size(), histograms.size(),
                    winner, secondScore, margin, "GATE_5_CONFIDENCE", reason, durationMs
            );
            return MatchResult.noMatchWithDiagnostics(
                    queryFingerprints.size(), durationMs, roundedScore, roundedConfidence,
                    totalWinnerVotes, winner.getTopBuckets(15),
                    reason, diag
            );
        }

        // Gate 6: Verify song exists in catalogue
        Optional<Song> songOpt = songRepository.findById(winner.getSongId());
        if (songOpt.isEmpty()) {
            log.warn("Match rejected: candidate songId={} not found in database", winner.getSongId());
            MatchDiagnostics diag = buildDiagnostics(
                    queryFingerprints.size(), queryTimesByHash.size(), candidates.size(), histograms.size(),
                    winner, secondScore, margin, "GATE_6_CATALOGUE_NOT_FOUND",
                    "Winning candidate metadata was not found in the catalogue.", durationMs
            );
            return MatchResult.noMatch(queryFingerprints.size(), durationMs, "Winning candidate metadata was not found in the catalogue.", diag);
        }

        Song song = songOpt.get();
        int estimatedOffsetMs = Math.max(0, winner.getPeakOffsetMs());

        log.info("MATCH IDENTIFIED: '{}' by '{}' at offset {}ms (votes={}, score={:.2f}, conf={:.2f}, margin={:.2f}) in {:.2f}ms",
                song.title(), song.artist(), estimatedOffsetMs, winnerPeakVotes, winnerScore, roundedConfidence, margin, durationMs);

        MatchDiagnostics diag = buildDiagnostics(
                queryFingerprints.size(), queryTimesByHash.size(), candidates.size(), histograms.size(),
                winner, secondScore, margin, "NONE", "Acoustic match confirmed with high confidence.", durationMs
        );

        return new MatchResult(
                true,
                song,
                estimatedOffsetMs,
                roundedScore,
                roundedConfidence,
                totalWinnerVotes,
                queryFingerprints.size(),
                Math.round(durationMs * 10.0) / 10.0,
                winner.getTopBuckets(15),
                "Acoustic match confirmed with high confidence.",
                diag
        );
    }

    private MatchDiagnostics buildDiagnostics(
            int queryFPs, int distinctHashes, int candidateRows, int candidateSongs,
            OffsetHistogram winner, double secondScore, double margin,
            String rejectionGate, String rejectionReason, double durationMs
    ) {
        if (winner == null) {
            return new MatchDiagnostics(
                    queryFPs, distinctHashes, candidateRows, candidateSongs,
                    null, null, null, 0.0, 0, 0, 0, 0.0, 0.0, 0.0, 0,
                    rejectionGate, rejectionReason, Math.round(durationMs * 10.0) / 10.0,
                    Collections.emptyList()
            );
        }
        int peakVotes = winner.getPeakVotes();
        int totalVotes = winner.getTotalMatches();
        int rawPairwiseVotes = winner.getRawPairwiseMatches();
        double coherenceRatio = totalVotes > 0 ? (double) peakVotes / totalVotes : 0.0;

        String winnerTitle = null;
        String winnerArtist = null;
        try {
            Optional<Song> songOpt = songRepository.findById(winner.getSongId());
            if (songOpt.isPresent()) {
                winnerTitle = songOpt.get().title();
                winnerArtist = songOpt.get().artist();
            }
        } catch (Exception e) {
            log.debug("Could not resolve winner metadata for diagnostics: {}", e.getMessage());
        }

        return new MatchDiagnostics(
                queryFPs,
                distinctHashes,
                candidateRows,
                candidateSongs,
                winner.getSongId(),
                winnerTitle,
                winnerArtist,
                Math.round(winner.calculateScore() * 10.0) / 10.0,
                peakVotes,
                totalVotes,
                rawPairwiseVotes,
                Math.round(coherenceRatio * 10000.0) / 10000.0,
                Math.round(secondScore * 10.0) / 10.0,
                Math.round(margin * 1000.0) / 1000.0,
                Math.max(0, winner.getPeakOffsetMs()),
                rejectionGate,
                rejectionReason,
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
