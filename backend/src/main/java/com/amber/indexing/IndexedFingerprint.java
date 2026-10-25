package com.amber.indexing;

/**
 * Fingerprint retrieved from the persistent index.
 */
public record IndexedFingerprint(int hash, long songId, int anchorTimeMs) {
}
