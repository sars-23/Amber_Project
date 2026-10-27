package com.amber.security;

public class RateLimitResult {

    private final boolean allowed;
    private final long retryAfterSeconds;
    private final int remainingRequests;

    public RateLimitResult(boolean allowed, long retryAfterSeconds, int remainingRequests) {
        this.allowed = allowed;
        this.retryAfterSeconds = retryAfterSeconds;
        this.remainingRequests = remainingRequests;
    }

    public static RateLimitResult allow(int remainingRequests) {
        return new RateLimitResult(true, 0, remainingRequests);
    }

    public static RateLimitResult reject(long retryAfterSeconds) {
        return new RateLimitResult(false, Math.max(1, retryAfterSeconds), 0);
    }

    public boolean isAllowed() {
        return allowed;
    }

    public long getRetryAfterSeconds() {
        return retryAfterSeconds;
    }

    public int getRemainingRequests() {
        return remainingRequests;
    }
}
