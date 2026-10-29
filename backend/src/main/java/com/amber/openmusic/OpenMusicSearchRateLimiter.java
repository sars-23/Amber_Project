package com.amber.openmusic;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

/**
 * Bounded in-memory sliding-window rate limiter for the public Jamendo search endpoint.
 * Protects downstream Jamendo API quotas and prevents abuse without requiring Redis.
 *
 * Honors Amber's trusted reverse-proxy architecture: when behind Render's proxy,
 * client identity is resolved from the rightmost valid token of X-Forwarded-For
 * to prevent caller-controlled spoofing.
 */
@Component
public class OpenMusicSearchRateLimiter {
    public static final int DEFAULT_MAX_REQUESTS = 30;
    public static final int DEFAULT_WINDOW_SECONDS = 60;
    private static final int MAX_TRACKED_IPS = 5000;

    private static final Pattern IPV4_PATTERN = Pattern.compile(
            "^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$"
    );

    private final int maxRequests;
    private final Duration windowDuration;
    private final boolean behindProxy;
    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    @Autowired
    public OpenMusicSearchRateLimiter(
            @Value("${amber.open-music.rate-limit.max-requests:30}") int maxRequests,
            @Value("${amber.open-music.rate-limit.window-seconds:60}") int windowSeconds,
            @Value("${amber.proxy.behind-proxy:true}") boolean behindProxy
    ) {
        this.maxRequests = maxRequests;
        this.windowDuration = Duration.ofSeconds(windowSeconds);
        this.behindProxy = behindProxy;
    }

    public OpenMusicSearchRateLimiter() {
        this(DEFAULT_MAX_REQUESTS, DEFAULT_WINDOW_SECONDS, true);
    }

    public OpenMusicSearchRateLimiter(int maxRequests, Duration windowDuration) {
        this(maxRequests, (int) windowDuration.toSeconds(), true);
    }

    public OpenMusicSearchRateLimiter(int maxRequests, Duration windowDuration, boolean behindProxy) {
        this(maxRequests, (int) windowDuration.toSeconds(), behindProxy);
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

    /**
     * Resolves the real client IP address safely.
     * When behind Render's reverse proxy:
     * Render connects directly to the container and appends the connecting client's IP
     * to the rightmost position of the X-Forwarded-For header.
     * Taking the rightmost valid IP prevents callers from spoofing their IP by sending
     * fake leftmost X-Forwarded-For entries.
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

        String remote = request.getRemoteAddr();
        if (remote != null && !remote.isBlank()) {
            return remote.trim();
        }

        return "127.0.0.1";
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

    public static boolean isValidIp(String ip) {
        if (ip == null || ip.isBlank() || ip.length() > 45) return false;
        if (IPV4_PATTERN.matcher(ip).matches()) {
            return true;
        }
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
}
