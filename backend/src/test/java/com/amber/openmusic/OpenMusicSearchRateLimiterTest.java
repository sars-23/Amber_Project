package com.amber.openmusic;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.*;

class OpenMusicSearchRateLimiterTest {

    private OpenMusicSearchRateLimiter rateLimiter;

    @BeforeEach
    void setUp() {
        // Create rate limiter with 3 requests per 10 seconds for precise testing
        rateLimiter = new OpenMusicSearchRateLimiter(3, Duration.ofSeconds(10));
    }

    @Test
    @DisplayName("Allows requests up to the max threshold and rejects exceeding requests")
    void testRateLimitThreshold() {
        String clientIp = "192.168.1.100";

        assertTrue(rateLimiter.tryAcquire(clientIp), "Request 1 should be allowed");
        assertTrue(rateLimiter.tryAcquire(clientIp), "Request 2 should be allowed");
        assertTrue(rateLimiter.tryAcquire(clientIp), "Request 3 should be allowed");

        // 4th request exceeds threshold
        assertFalse(rateLimiter.tryAcquire(clientIp), "Request 4 should be rejected");

        // Retry-After should be positive
        long retryAfter = rateLimiter.getRetryAfterSeconds(clientIp);
        assertTrue(retryAfter > 0 && retryAfter <= 10, "Retry-After should be between 1 and 10 seconds");
    }

    @Test
    @DisplayName("Different client IPs track rate limits independently")
    void testIndependentIps() {
        String ip1 = "10.0.0.1";
        String ip2 = "10.0.0.2";

        assertTrue(rateLimiter.tryAcquire(ip1));
        assertTrue(rateLimiter.tryAcquire(ip1));
        assertTrue(rateLimiter.tryAcquire(ip1));
        assertFalse(rateLimiter.tryAcquire(ip1));

        // IP2 still has full quota
        assertTrue(rateLimiter.tryAcquire(ip2));
        assertTrue(rateLimiter.tryAcquire(ip2));
    }

    @Test
    @DisplayName("Empty or null IP is gracefully permitted")
    void testNullOrEmptyIp() {
        assertTrue(rateLimiter.tryAcquire(null));
        assertTrue(rateLimiter.tryAcquire(""));
    }
}
