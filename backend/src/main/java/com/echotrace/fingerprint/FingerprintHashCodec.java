package com.echotrace.fingerprint;

/**
 * Compact 32-bit integer encoding for constellation peak pairs.
 * Bit allocation (24 bits total within a 32-bit integer):
 * - Bits 15..23 (9 bits): Anchor frequency bin (0..511)
 * - Bits  6..14 (9 bits): Target frequency bin (0..511)
 * - Bits  0.. 5 (6 bits): Frame delta between anchor and target (1..63)
 */
public final class FingerprintHashCodec {

    public static final int MAX_FREQ_BIN = 511; // 2^9 - 1
    public static final int MIN_FRAME_DELTA = 1;
    public static final int MAX_FRAME_DELTA = 63; // 2^6 - 1

    private FingerprintHashCodec() {}

    /**
     * Encodes anchor frequency, target frequency, and frame delta into a single 32-bit integer.
     */
    public static int encode(int anchorFrequencyBin, int targetFrequencyBin, int frameDelta) {
        if (anchorFrequencyBin < 0 || anchorFrequencyBin > MAX_FREQ_BIN) {
            throw new IllegalArgumentException(String.format(
                    "Anchor frequency bin %d out of range [0, %d]", anchorFrequencyBin, MAX_FREQ_BIN));
        }
        if (targetFrequencyBin < 0 || targetFrequencyBin > MAX_FREQ_BIN) {
            throw new IllegalArgumentException(String.format(
                    "Target frequency bin %d out of range [0, %d]", targetFrequencyBin, MAX_FREQ_BIN));
        }
        if (frameDelta < MIN_FRAME_DELTA || frameDelta > MAX_FRAME_DELTA) {
            throw new IllegalArgumentException(String.format(
                    "Frame delta %d out of range [%d, %d]", frameDelta, MIN_FRAME_DELTA, MAX_FRAME_DELTA));
        }

        return ((anchorFrequencyBin & 0x1FF) << 15)
                | ((targetFrequencyBin & 0x1FF) << 6)
                | (frameDelta & 0x3F);
    }

    /**
     * Extracts anchor frequency bin from a 32-bit hash.
     */
    public static int decodeAnchorFrequency(int hash) {
        return (hash >>> 15) & 0x1FF;
    }

    /**
     * Extracts target frequency bin from a 32-bit hash.
     */
    public static int decodeTargetFrequency(int hash) {
        return (hash >>> 6) & 0x1FF;
    }

    /**
     * Extracts frame delta from a 32-bit hash.
     */
    public static int decodeFrameDelta(int hash) {
        return hash & 0x3F;
    }

    /**
     * Formats the hash as a hex string for logging and diagnostics.
     */
    public static String toHexString(int hash) {
        return String.format("0x%06X", hash & 0xFFFFFF);
    }
}
