package com.amber.security;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;

class ClientRateLimiterTest {

    @Test
    @DisplayName("Should allow requests up to the max limit and reject on exceeding")
    void shouldEnforceRateLimit() {
        ClientRateLimiter limiter = new ClientRateLimiter(5, 60, 100, true);
        String clientIp = "192.0.2.1";

        // First 5 requests should succeed
        for (int i = 0; i < 5; i++) {
            RateLimitResult result = limiter.tryAcquire(clientIp);
            assertThat(result.isAllowed()).isTrue();
        }

        // 6th request should be rejected with 429 semantics
        RateLimitResult blocked = limiter.tryAcquire(clientIp);
        assertThat(blocked.isAllowed()).isFalse();
        assertThat(blocked.getRetryAfterSeconds()).isGreaterThanOrEqualTo(1);
    }

    @Test
    @DisplayName("Should track different client IPs independently")
    void shouldTrackClientsIndependently() {
        ClientRateLimiter limiter = new ClientRateLimiter(2, 60, 100, true);

        assertThat(limiter.tryAcquire("198.51.100.1").isAllowed()).isTrue();
        assertThat(limiter.tryAcquire("198.51.100.1").isAllowed()).isTrue();
        assertThat(limiter.tryAcquire("198.51.100.1").isAllowed()).isFalse();

        // Client 2 is untouched
        assertThat(limiter.tryAcquire("198.51.100.2").isAllowed()).isTrue();
        assertThat(limiter.tryAcquire("198.51.100.2").isAllowed()).isTrue();
        assertThat(limiter.tryAcquire("198.51.100.2").isAllowed()).isFalse();
    }

    @Test
    @DisplayName("Should safely resolve client IP from X-Forwarded-For behind reverse proxy")
    void shouldResolveClientIpBehindProxy() {
        ClientRateLimiter limiter = new ClientRateLimiter(10, 60, 100, true);

        // Render appends the verified connecting IP to the end of X-Forwarded-For
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Forwarded-For", "spoofed.client.ip, 203.0.113.88");

        String resolved = limiter.resolveClientIp(request);
        assertThat(resolved).isEqualTo("203.0.113.88");
    }

    @Test
    @DisplayName("Should fallback to getRemoteAddr when no proxy header is present")
    void shouldFallbackToRemoteAddr() {
        ClientRateLimiter limiter = new ClientRateLimiter(10, 60, 100, true);

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("10.0.0.5");

        String resolved = limiter.resolveClientIp(request);
        assertThat(resolved).isEqualTo("10.0.0.5");
    }

    @Test
    @DisplayName("Should strictly bound tracked clients map to prevent memory exhaustion")
    void shouldBoundTrackedClientsMemory() {
        int maxClients = 50;
        ClientRateLimiter limiter = new ClientRateLimiter(10, 60, maxClients, true);

        // Insert 200 distinct client IPs
        for (int i = 1; i <= 200; i++) {
            limiter.tryAcquire("10.0.0." + i);
        }

        // Must not exceed maxClients
        assertThat(limiter.getTrackedClientCount()).isLessThanOrEqualTo(maxClients);
    }
}
