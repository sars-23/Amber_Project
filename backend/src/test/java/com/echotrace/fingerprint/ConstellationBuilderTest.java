package com.echotrace.fingerprint;

import com.echotrace.dsp.SpectralPeak;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ConstellationBuilderTest {

    @Test
    @DisplayName("Should pair anchor peak with valid forward target peaks within delta limits")
    void testPairingWithinDeltaLimits() {
        ConstellationBuilder builder = new ConstellationBuilder(1, 10, 5);

        // Anchor at frame 0, targets at frame 2, frame 5, frame 15 (too far)
        List<SpectralPeak> peaks = List.of(
                new SpectralPeak(40, 0, 10.0),
                new SpectralPeak(80, 2, 8.0),
                new SpectralPeak(120, 5, 9.0),
                new SpectralPeak(160, 15, 7.0) // Beyond maxDeltaFrames=10
        );

        List<Fingerprint> fps = builder.buildFingerprints(peaks, 11025, 512);

        // Anchor peak at frame 0 pairs with frame 2 and frame 5
        // Peak at frame 2 pairs with frame 5
        // Peak at frame 5 pairs with frame 15 (15 - 5 = 10, exactly maxDeltaFrames)
        assertThat(fps).isNotEmpty();

        // Check anchor 0 pairings
        List<Fingerprint> fromAnchor0 = fps.stream()
                .filter(fp -> fp.anchorFrame() == 0)
                .toList();

        assertThat(fromAnchor0).hasSize(2);
        assertThat(fromAnchor0.get(0).getAnchorFrequency()).isEqualTo(40);
        assertThat(fromAnchor0.get(0).getTargetFrequency()).isEqualTo(80);
        assertThat(fromAnchor0.get(0).getFrameDelta()).isEqualTo(2);

        assertThat(fromAnchor0.get(1).getAnchorFrequency()).isEqualTo(40);
        assertThat(fromAnchor0.get(1).getTargetFrequency()).isEqualTo(120);
        assertThat(fromAnchor0.get(1).getFrameDelta()).isEqualTo(5);
    }

    @Test
    @DisplayName("Should respect max targets per anchor limit")
    void testMaxTargetsPerAnchor() {
        ConstellationBuilder builder = new ConstellationBuilder(1, 20, 2); // Max 2 targets

        List<SpectralPeak> peaks = List.of(
                new SpectralPeak(40, 0, 10.0),
                new SpectralPeak(50, 1, 9.0),
                new SpectralPeak(60, 2, 8.0),
                new SpectralPeak(70, 3, 7.0),
                new SpectralPeak(80, 4, 6.0)
        );

        List<Fingerprint> fps = builder.buildFingerprints(peaks, 11025, 512);

        List<Fingerprint> fromAnchor0 = fps.stream()
                .filter(fp -> fp.anchorFrame() == 0)
                .toList();

        assertThat(fromAnchor0).hasSize(2); // Capped at 2
    }

    @Test
    @DisplayName("Should return empty list when peaks list has fewer than 2 peaks")
    void testEmptyOrSinglePeak() {
        ConstellationBuilder builder = new ConstellationBuilder();
        assertThat(builder.buildFingerprints(List.of(), 11025, 512)).isEmpty();
        assertThat(builder.buildFingerprints(List.of(new SpectralPeak(40, 0, 10.0)), 11025, 512)).isEmpty();
    }
}
