package com.echotrace.matching;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OffsetHistogramTest {

    @Test
    @DisplayName("Should accumulate votes into correct 100ms buckets including negative offsets")
    void testBucketing() {
        OffsetHistogram hist = new OffsetHistogram(1L, 100);

        // Positive offsets around 1500ms
        hist.addVote(1510);
        hist.addVote(1540);
        hist.addVote(1580);
        hist.addVote(200);

        // Negative offsets around -300ms
        hist.addVote(-290); // floorDiv(-290, 100) * 100 = -3 * 100 = -300
        hist.addVote(-250); // -300

        assertThat(hist.getTotalMatches()).isEqualTo(6);
        assertThat(hist.getPeakVotes()).isEqualTo(3);
        assertThat(hist.getPeakOffsetMs()).isEqualTo(1500);

        List<OffsetHistogram.HistogramBucket> topBuckets = hist.getTopBuckets(5);
        assertThat(topBuckets).isNotEmpty();
    }

    @Test
    @DisplayName("Should calculate score penalizing noise floor")
    void testScore() {
        OffsetHistogram coherent = new OffsetHistogram(1L, 100);
        // Concentrated peak of 20 votes at 1000ms
        for (int i = 0; i < 20; i++) {
            coherent.addVote(1005);
        }
        // Small scatter
        coherent.addVote(200);
        coherent.addVote(300);

        double coherentScore = coherent.calculateScore();
        assertThat(coherentScore).isGreaterThan(15.0);

        // Scattered histogram with no clear peak (noise)
        OffsetHistogram noisy = new OffsetHistogram(2L, 100);
        for (int i = 0; i < 20; i++) {
            noisy.addVote(i * 150); // Different bucket every time
        }
        double noisyScore = noisy.calculateScore();
        assertThat(noisyScore).isLessThan(coherentScore);
    }

    @Test
    @DisplayName("Should reject invalid bucket width")
    void testInvalidBucketWidth() {
        assertThatThrownBy(() -> new OffsetHistogram(1L, 0))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
