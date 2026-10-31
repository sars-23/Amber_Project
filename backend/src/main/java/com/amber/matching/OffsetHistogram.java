package com.amber.matching;

import java.util.*;

/**
 * Accumulator for time-coherent timestamp offset votes for a single candidate song.
 *
 * Implements independent query evidence counting:
 * - A single query fingerprint occurrence (hash, anchorTimeMs) can support a given
 *   offset bucket at most once, even if multiple identical or repeated database rows
 *   produce the same offset.
 * - Raw pairwise hash matches are retained separately for diagnostic observability.
 * - Coherence ratio is calculated as (peakUniqueQuerySupport / totalUniqueQuerySupportForCandidate).
 */
public final class OffsetHistogram {

    public static final int DEFAULT_BUCKET_WIDTH_MS = 100;

    private final long songId;
    private final int bucketWidthMs;

    // Distinct query fingerprint occurrences supporting each offset bucket
    private final Map<Integer, Set<QueryPoint>> bucketQuerySupport = new HashMap<>();

    // Distinct query fingerprint occurrences supporting this candidate song across all buckets
    private final Set<QueryPoint> uniqueQueryPoints = new HashSet<>();

    // Total raw pairwise combinations accumulated (Cartesian candidate row x query time)
    private int rawPairwiseMatches = 0;

    // Synthetic counter for backwards-compatible addVote(offsetMs) calls in legacy tests
    private int syntheticCounter = 0;

    public OffsetHistogram(long songId) {
        this(songId, DEFAULT_BUCKET_WIDTH_MS);
    }

    public OffsetHistogram(long songId, int bucketWidthMs) {
        if (bucketWidthMs <= 0) {
            throw new IllegalArgumentException("Bucket width must be positive: " + bucketWidthMs);
        }
        this.songId = songId;
        this.bucketWidthMs = bucketWidthMs;
    }

    /**
     * Adds an evidence match from a specific query fingerprint occurrence.
     * Guarantees that queryPoint contributes at most 1 vote to the target bucket,
     * and at most 1 vote to the candidate's total distinct query support.
     */
    public void addMatch(int offsetMs, int queryHash, int queryTimeMs) {
        rawPairwiseMatches++;
        QueryPoint qp = new QueryPoint(queryHash, queryTimeMs);
        uniqueQueryPoints.add(qp);

        int bucketKey = Math.floorDiv(offsetMs, bucketWidthMs) * bucketWidthMs;
        bucketQuerySupport.computeIfAbsent(bucketKey, k -> new HashSet<>()).add(qp);
    }

    /**
     * Backwards-compatible vote method for synthetic offset tests without query coordinates.
     */
    public void addVote(int offsetMs) {
        addMatch(offsetMs, ++syntheticCounter, 0);
    }

    public long getSongId() {
        return songId;
    }

    /**
     * Returns the total distinct query fingerprint occurrences that matched this candidate song.
     */
    public int getTotalMatches() {
        return uniqueQueryPoints.size();
    }

    /**
     * Returns the total distinct query fingerprint occurrences that matched this candidate song.
     */
    public int getUniqueQuerySupport() {
        return uniqueQueryPoints.size();
    }

    /**
     * Returns the raw count of all pairwise combinations before distinct query deduplication.
     */
    public int getRawPairwiseMatches() {
        return rawPairwiseMatches;
    }

    /**
     * Returns the maximum independent query support across any offset bucket.
     */
    public int getPeakVotes() {
        return bucketQuerySupport.values().stream()
                .mapToInt(Set::size)
                .max()
                .orElse(0);
    }

    public int getPeakOffsetMs() {
        return bucketQuerySupport.entrySet().stream()
                .max(Comparator.comparingInt(e -> e.getValue().size()))
                .map(Map.Entry::getKey)
                .orElse(0);
    }

    /**
     * Computes the median independent vote count across background scatter buckets (excluding the peak bucket).
     */
    public double getMedianNoiseVotes() {
        if (bucketQuerySupport.size() <= 1) {
            return 0.0;
        }
        List<Integer> votesList = new ArrayList<>();
        for (Set<QueryPoint> set : bucketQuerySupport.values()) {
            votesList.add(set.size());
        }
        Collections.sort(votesList);
        // Exclude the peak bucket (the largest element)
        votesList.remove(votesList.size() - 1);
        int size = votesList.size();
        if (size % 2 == 1) {
            return votesList.get(size / 2);
        } else {
            return (votesList.get(size / 2 - 1) + votesList.get(size / 2)) / 2.0;
        }
    }

    /**
     * Calculates the coherence score:
     * Peak independent votes penalized by background noise scatter, boosted by coherence ratio.
     */
    public double calculateScore() {
        int peakVotes = getPeakVotes();
        if (peakVotes == 0) {
            return 0.0;
        }
        double medianNoise = getMedianNoiseVotes();
        double signalToNoise = Math.max(0.0, peakVotes - medianNoise);
        int totalMatches = getTotalMatches();
        double coherenceRatio = totalMatches > 0 ? (double) peakVotes / totalMatches : 0.0;

        return signalToNoise * (1.0 + coherenceRatio);
    }

    /**
     * Returns top buckets around the peak sorted chronologically for visualization charts.
     */
    public List<HistogramBucket> getTopBuckets(int limit) {
        return bucketQuerySupport.entrySet().stream()
                .sorted((a, b) -> Integer.compare(b.getValue().size(), a.getValue().size()))
                .limit(limit)
                .sorted(Map.Entry.comparingByKey())
                .map(e -> new HistogramBucket(e.getKey(), e.getValue().size()))
                .toList();
    }

    public record HistogramBucket(int offsetMs, int votes) {}

    /**
     * Unique query fingerprint occurrence identifier.
     */
    public record QueryPoint(int hash, int anchorTimeMs) {}
}
