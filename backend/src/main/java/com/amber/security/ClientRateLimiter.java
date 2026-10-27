package com.amber.security;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.*;
import java.util.regex.Pattern;

/**
 * Bounded, in-memory sliding-window rate limiter designed for Render-hosted Spring Boot services.
 * Enforces per-client request limits while preventing memory exhaustion and reverse-proxy IP spoofing.
 */
@Component
public class ClientRateLimiter {

    private static final Logger log = LoggerFactory.getLogger(ClientRateLimiter.class);

    private static final Pattern IPV4_PATTERN = Pattern.compile(
            "^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$"
    );

    private final int maxRequests;
    private final long windowMillis;
    private final int maxTrackedClients;
    private final boolean behindProxy;

    // LRU cache with access-order eviction to strictly bound memory
    private final Map<String, ClientWindow> clientWindows;

    public ClientRateLimiter(
            @Value("${amber.rate-limit.benchmark.max-requests:10}") int maxRequests,
            @Value("${amber.rate-limit.benchmark.window-seconds:60}") int windowSeconds,
            @Value("${amber.rate-limit.benchmark.max-tracked-clients:10000}") int maxTrackedClients,
            @Value("${amber.proxy.behind-proxy:true}") boolean behindProxy
    ) {
        this.maxRequests = maxRequests;
        this.windowMillis = windowSeconds * 1000L;
        this.maxTrackedClients = maxTrackedClients;
        this.behindProxy = behindProxy;

        this.clientWindows = Collections.synchronizedMap(new LinkedHashMap<>(128, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, ClientWindow> eldest) {
                return size() > maxTrackedClients;
            }
        });
    }

    /**
     * Evaluates rate-limit quota for the incoming HTTP request.
     *
     * @param request HTTP request to extract client identity from
     * @return RateLimitResult indicating whether the request is allowed or rate-limited
     */
    public RateLimitResult tryAcquire(HttpServletRequest request) {
        String clientIp = resolveClientIp(request);
        return tryAcquire(clientIp);
    }

    /**
     * Evaluates rate-limit quota for a given client identifier.
     *
     * @param clientIp client IP or identifier
     * @return RateLimitResult
     */
    public RateLimitResult tryAcquire(String clientIp) {
        long now = System.currentTimeMillis();

        ClientWindow window;
        synchronized (clientWindows) {
            window = clientWindows.computeIfAbsent(clientIp, k -> new ClientWindow());
        }

        synchronized (window) {
            window.evictOlderThan(now - windowMillis);

            if (window.count() < maxRequests) {
                window.record(now);
                int remaining = maxRequests - window.count();
                return RateLimitResult.allow(remaining);
            } else {
                long oldest = window.getOldestTimestamp();
                long retryAfterMillis = Math.max(0, (oldest + windowMillis) - now);
                long retryAfterSecs = (retryAfterMillis + 999) / 1000; // round up
                return RateLimitResult.reject(Math.max(1, retryAfterSecs));
            }
        }
    }

    /**
     * Resolves the real client IP address.
     * When behind Render's reverse proxy:
     * Render connects directly to the container and appends the connecting client's IP
     * to the rightmost position of the X-Forwarded-For header.
     * If an external client attempts to spoof X-Forwarded-For: "fake.ip",
     * Render forwards: "fake.ip, actual.client.ip".
     * Thus, taking the last valid IP in the list guarantees Render-verified identity.
     */
    public String resolveClientIp(HttpServletRequest request) {
        if (request == null) return "127.0.0.1";

        if (behindProxy) {
            String forwardedFor = request.getHeader("X-Forwarded-For");
            if (forwardedFor != null && !forwardedFor.isBlank()) {
                String[] tokens = forwardedFor.split(",");
                // Evaluate rightmost first (Render appends the connecting peer IP to the end)
                for (int i = tokens.length - 1; i >= 0; i--) {
                    String candidate = tokens[i].trim();
                    if (isValidIp(candidate)) {
                        return candidate;
                    }
                }
            }

            String realIp = request.getHeader("X-Real-IP");
            if (realIp != null && !realIp.isBlank() && isValidIp(realIp.trim())) {
                return realIp.trim();
            }
        }

        String remoteAddr = request.getRemoteAddr();
        if (remoteAddr != null && !remoteAddr.isBlank()) {
            return remoteAddr.trim();
        }

        return "127.0.0.1";
    }

    private boolean isValidIp(String ip) {
        if (ip == null || ip.isBlank() || ip.length() > 45) return false;

        if (IPV4_PATTERN.matcher(ip).matches()) {
            return true;
        }

        // Basic IPv6 check
        if (ip.contains(":")) {
            try {
                InetAddress addr = InetAddress.getByName(ip);
                return addr != null;
            } catch (UnknownHostException e) {
                return false;
            }
        }

        return false;
    }

    /**
     * Resets rate-limit state (useful for test isolation).
     */
    public void reset() {
        clientWindows.clear();
    }

    public int getTrackedClientCount() {
        return clientWindows.size();
    }

    private static class ClientWindow {
        private final ArrayDeque<Long> timestamps = new ArrayDeque<>(16);

        public void evictOlderThan(long cutoff) {
            while (!timestamps.isEmpty() && timestamps.peekFirst() <= cutoff) {
                timestamps.pollFirst();
            }
        }

        public void record(long timestamp) {
            timestamps.addLast(timestamp);
        }

        public int count() {
            return timestamps.size();
        }

        public long getOldestTimestamp() {
            return timestamps.isEmpty() ? 0 : timestamps.peekFirst();
        }
    }
}
