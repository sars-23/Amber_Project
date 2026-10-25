package com.echotrace.matching;

import java.util.*;

/**
 * Accumulator for time-coherent timestamp offset votes for a single candidate song.
 * Offset delta = (databaseAnchorTimeMs - queryAnchorTimeMs).
 */
public final class OffsetHistogram {

    public static final int DEFAULT_BUCKET_WIDTH_MS = 100;

    private final long songId;
    private final int bucketWidthMs;
    private final Map<Integer, Integer> bucketVotes = new HashMap<>();
    private int totalMatches = 0;

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
     * Adds a vote for a timestamp offset.
     * Uses Math.floorDiv to prevent asymmetrical truncation of negative offsets.
     */
    public void addVote(int offsetMs) {
        int bucketKey = Math.floorDiv(offsetMs, bucketWidthMs) * bucketWidthMs;
        bucketVotes.merge(bucketKey, 1, Integer::sum);
        totalMatches++;
    }

    public long getSongId() {
        return songId;
    }

    public int getTotalMatches() {
        return totalMatches;
    }

    public int getPeakVotes() {
        return bucketVotes.values().stream().max(Integer::compareTo).orElse(0);
    }

    public int getPeakOffsetMs() {
        return bucketVotes.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey)
                .orElse(0);
    }

    /**
     * Computes the median vote count across background scatter buckets (excluding the peak bucket).
     */
    public double getMedianNoiseVotes() {
        if (bucketVotes.size() <= 1) {
            return 0.0;
        }
        List<Integer> votesList = new ArrayList<>(bucketVotes.values());
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
     * Peak votes penalized by background noise scatter.
     */
    public double calculateScore() {
        int peakVotes = getPeakVotes();
        if (peakVotes == 0) {
            return 0.0;
        }
        double medianNoise = getMedianNoiseVotes();
        double signalToNoise = Math.max(0.0, peakVotes - medianNoise);
        double coherenceRatio = (double) peakVotes / totalMatches;

        return signalToNoise * (1.0 + coherenceRatio);
    }

    /**
     * Returns top buckets around the peak sorted chronologically for visualization charts.
     */
    public List<HistogramBucket> getTopBuckets(int limit) {
        return bucketVotes.entrySet().stream()
                .sorted(Map.Entry.<Integer, Integer>comparingByValue().reversed())
                .limit(limit)
                .sorted(Map.Entry.comparingByKey())
                .map(e -> new HistogramBucket(e.getKey(), e.getValue()))
                .toList();
    }

    public record HistogramBucket(int offsetMs, int votes) {}
}
