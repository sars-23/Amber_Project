package com.echotrace.fingerprint;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FingerprintHashCodecTest {

    @ParameterizedTest
    @CsvSource({
            "0, 0, 1",
            "511, 511, 63",
            "41, 82, 10",
            "100, 250, 32",
            "0, 511, 1",
            "511, 0, 63"
    })
    @DisplayName("Should encode and decode round-trip perfectly across valid ranges")
    void testEncodeDecodeRoundTrip(int anchorFreq, int targetFreq, int deltaFrames) {
        int hash = FingerprintHashCodec.encode(anchorFreq, targetFreq, deltaFrames);

        assertThat(FingerprintHashCodec.decodeAnchorFrequency(hash)).isEqualTo(anchorFreq);
        assertThat(FingerprintHashCodec.decodeTargetFrequency(hash)).isEqualTo(targetFreq);
        assertThat(FingerprintHashCodec.decodeFrameDelta(hash)).isEqualTo(deltaFrames);
    }

    @Test
    @DisplayName("Should validate out of bound parameters")
    void testInvalidParameters() {
        // Anchor frequency out of range
        assertThatThrownBy(() -> FingerprintHashCodec.encode(-1, 100, 10))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> FingerprintHashCodec.encode(512, 100, 10))
                .isInstanceOf(IllegalArgumentException.class);

        // Target frequency out of range
        assertThatThrownBy(() -> FingerprintHashCodec.encode(100, -1, 10))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> FingerprintHashCodec.encode(100, 512, 10))
                .isInstanceOf(IllegalArgumentException.class);

        // Delta frames out of range [1, 63]
        assertThatThrownBy(() -> FingerprintHashCodec.encode(100, 100, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> FingerprintHashCodec.encode(100, 100, 64))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("Should generate proper hex string representation")
    void testToHexString() {
        int hash = FingerprintHashCodec.encode(41, 82, 10);
        String hex = FingerprintHashCodec.toHexString(hash);
        assertThat(hex).startsWith("0x");
        assertThat(hex).hasSize(8); // 0x + 6 hex characters
    }
}
