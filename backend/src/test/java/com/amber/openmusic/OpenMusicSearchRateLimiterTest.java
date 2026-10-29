package com.amber.openmusic;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.*;

class OpenMusicSearchRateLimiterTest {

    private OpenMusicSearchRateLimiter rateLimiter;

    @BeforeEach
    void setUp() {
        // Create rate limiter with 3 requests per 10 seconds for precise testing
        rateLimiter = new OpenMusicSearchRateLimiter(3, Duration.ofSeconds(10), true);
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

    @Test
    @DisplayName("Resolves client IP from rightmost valid token of X-Forwarded-For behind reverse proxy")
    void testRightmostForwardedIpBehindProxy() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("10.0.0.1"); // internal proxy hop
        request.addHeader("X-Forwarded-For", "spoofed.client.ip, 198.51.100.42");

        String resolved = rateLimiter.resolveClientIp(request);
        assertEquals("198.51.100.42", resolved);
    }

    @Test
    @DisplayName("Spoofed leftmost X-Forwarded-For cannot bypass rate limiting")
    void testSpoofedHeadersCannotBypassRateLimit() {
        // Attacker attempts to bypass rate limit by rotating the leftmost IP
        String realConnectingIp = "203.0.113.88";

        for (int i = 1; i <= 3; i++) {
            MockHttpServletRequest req = new MockHttpServletRequest();
            req.setRemoteAddr("10.0.0.1");
            req.addHeader("X-Forwarded-For", "1.2.3." + i + ", " + realConnectingIp);
            String clientIp = rateLimiter.resolveClientIp(req);
            assertEquals(realConnectingIp, clientIp);
            assertTrue(rateLimiter.tryAcquire(clientIp), "Request " + i + " should be permitted");
        }

        // 4th request from same real client with another spoofed leftmost IP must be blocked
        MockHttpServletRequest req4 = new MockHttpServletRequest();
        req4.setRemoteAddr("10.0.0.1");
        req4.addHeader("X-Forwarded-For", "9.9.9.9, " + realConnectingIp);
        String clientIp4 = rateLimiter.resolveClientIp(req4);
        assertEquals(realConnectingIp, clientIp4);
        assertFalse(rateLimiter.tryAcquire(clientIp4), "4th request must be rate limited despite spoofed header");
    }

    @Test
    @DisplayName("Falls back to X-Real-IP if X-Forwarded-For is missing")
    void testFallbackToXRealIp() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("10.0.0.1");
        request.addHeader("X-Real-IP", "198.51.100.99");

        assertEquals("198.51.100.99", rateLimiter.resolveClientIp(request));
    }

    @Test
    @DisplayName("Uses RemoteAddr when behindProxy is disabled")
    void testUsesRemoteAddrWhenNotBehindProxy() {
        OpenMusicSearchRateLimiter directLimiter = new OpenMusicSearchRateLimiter(5, Duration.ofMinutes(1), false);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("192.168.1.50");
        request.addHeader("X-Forwarded-For", "spoofed.ip.address");

        assertEquals("192.168.1.50", directLimiter.resolveClientIp(request));
    }

    @Test
    @DisplayName("Validates both IPv4 and IPv6 addresses correctly")
    void testIpValidation() {
        assertTrue(OpenMusicSearchRateLimiter.isValidIp("192.168.1.1"));
        assertTrue(OpenMusicSearchRateLimiter.isValidIp("2001:db8::1"));
        assertTrue(OpenMusicSearchRateLimiter.isValidIp("::1"));

        assertFalse(OpenMusicSearchRateLimiter.isValidIp("invalid-ip"));
        assertFalse(OpenMusicSearchRateLimiter.isValidIp("999.999.999.999"));
        assertFalse(OpenMusicSearchRateLimiter.isValidIp(""));
        assertFalse(OpenMusicSearchRateLimiter.isValidIp(null));
    }
}
