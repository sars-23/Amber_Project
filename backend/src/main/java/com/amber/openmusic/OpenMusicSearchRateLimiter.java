package com.amber.openmusic;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Bounded in-memory sliding-window rate limiter for the public Jamendo search endpoint.
 * Protects downstream Jamendo API quotas and prevents abuse without requiring Redis.
 */
@Component
public class OpenMusicSearchRateLimiter {
    public static final int DEFAULT_MAX_REQUESTS = 30;
    public static final Duration DEFAULT_WINDOW = Duration.ofMinutes(1);
    private static final int MAX_TRACKED_IPS = 5000;

    private final int maxRequests;
    private final Duration windowDuration;
    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    public OpenMusicSearchRateLimiter() {
        this(DEFAULT_MAX_REQUESTS, DEFAULT_WINDOW);
    }

    public OpenMusicSearchRateLimiter(int maxRequests, Duration windowDuration) {
        this.maxRequests = maxRequests;
        this.windowDuration = windowDuration;
    }

    private static class Window {
        final Instant start;
        final AtomicInteger count;

        Window(Instant start) {
            this.start = start;
            this.count = new AtomicInteger(1);
        }
    }

    public boolean tryAcquire(String ip) {
        if (ip == null || ip.isBlank()) {
            return true;
        }
        Instant now = Instant.now();
        cleanupIfNecessary(now);

        Window window = windows.compute(ip, (k, current) -> {
            if (current == null || now.isAfter(current.start.plus(windowDuration))) {
                return new Window(now);
            }
            current.count.incrementAndGet();
            return current;
        });

        return window.count.get() <= maxRequests;
    }

    public long getRetryAfterSeconds(String ip) {
        if (ip == null || ip.isBlank()) return windowDuration.toSeconds();
        Window window = windows.get(ip);
        if (window == null) return 1L;
        long elapsed = Duration.between(window.start, Instant.now()).toSeconds();
        return Math.max(1L, windowDuration.toSeconds() - elapsed);
    }

    public String resolveClientIp(HttpServletRequest request) {
        if (request == null) return "unknown";
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            int comma = forwarded.indexOf(',');
            return (comma > 0 ? forwarded.substring(0, comma) : forwarded).trim();
        }
        String realIp = request.getHeader("X-Real-IP");
        if (realIp != null && !realIp.isBlank()) {
            return realIp.trim();
        }
        String remote = request.getRemoteAddr();
        return remote == null || remote.isBlank() ? "unknown" : remote;
    }

    public void reset() {
        windows.clear();
    }

    private void cleanupIfNecessary(Instant now) {
        if (windows.size() > MAX_TRACKED_IPS) {
            Instant expiryThreshold = now.minus(windowDuration);
            windows.entrySet().removeIf(entry -> entry.getValue().start.isBefore(expiryThreshold));
        }
    }
}
