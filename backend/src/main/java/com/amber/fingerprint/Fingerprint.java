package com.amber.fingerprint;

import java.util.Objects;

/**
 * Domain representation of an acoustic fingerprint.
 * Consists of a compact 32-bit combinatorial hash and its anchor point timestamp in milliseconds.
 */
public record Fingerprint(int hash, int anchorTimeMs, int anchorFrame, int targetFrame) implements Comparable<Fingerprint> {

    public Fingerprint {
        if (anchorTimeMs < 0) {
            throw new IllegalArgumentException("anchorTimeMs cannot be negative: " + anchorTimeMs);
        }
        if (anchorFrame < 0) {
            throw new IllegalArgumentException("anchorFrame cannot be negative: " + anchorFrame);
        }
        if (targetFrame < anchorFrame) {
            throw new IllegalArgumentException("targetFrame cannot precede anchorFrame: " + targetFrame + " < " + anchorFrame);
        }
    }

    public Fingerprint(int hash, int anchorTimeMs) {
        this(hash, anchorTimeMs, 0, 0);
    }

    public int getAnchorFrequency() {
        return FingerprintHashCodec.decodeAnchorFrequency(hash);
    }

    public int getTargetFrequency() {
        return FingerprintHashCodec.decodeTargetFrequency(hash);
    }

    public int getFrameDelta() {
        return FingerprintHashCodec.decodeFrameDelta(hash);
    }

    @Override
    public int compareTo(Fingerprint other) {
        int timeCompare = Integer.compare(this.anchorTimeMs, other.anchorTimeMs);
        if (timeCompare != 0) {
            return timeCompare;
        }
        return Integer.compare(this.hash, other.hash);
    }

    @Override
    public String toString() {
        return String.format("Fingerprint[hash=%s, t=%dms, f1=%d, f2=%d, dt=%d]",
                FingerprintHashCodec.toHexString(hash), anchorTimeMs,
                getAnchorFrequency(), getTargetFrequency(), getFrameDelta());
    }
}
