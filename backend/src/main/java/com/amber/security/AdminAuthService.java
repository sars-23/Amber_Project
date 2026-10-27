package com.amber.security;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Service responsible for authenticating and authorizing administrative write operations.
 * Fails closed if the server-side administrative key is unconfigured.
 */
@Service
public class AdminAuthService {

    private static final Logger log = LoggerFactory.getLogger(AdminAuthService.class);

    public static final String ADMIN_KEY_HEADER = "X-Amber-Admin-Key";
    public static final String AUTH_HEADER = "Authorization";
    public static final String BEARER_PREFIX = "Bearer ";

    private final String adminApiKey;

    public AdminAuthService(@Value("${amber.admin.api-key:}") String adminApiKey) {
        this.adminApiKey = (adminApiKey != null) ? adminApiKey.trim() : "";
    }

    /**
     * Verifies that the incoming HTTP request has valid administrative authorization.
     *
     * @param request the HTTP request
     * @throws AdminUnauthorizedException if no credential is provided (HTTP 401)
     * @throws AdminForbiddenException    if server key is unconfigured (fail-closed)
     *                                    or if credentials do not match (HTTP 403)
     */
    public void verifyAdminAccess(HttpServletRequest request) {
        String providedKey = extractAdminKey(request);

        if (providedKey == null || providedKey.isBlank()) {
            throw new AdminUnauthorizedException(
                    "Administrative authentication required. Provide '" + ADMIN_KEY_HEADER +
                    "' or '" + AUTH_HEADER + ": " + BEARER_PREFIX + "<key>'."
            );
        }

        // Fail closed if the server has no administrative key configured
        if (adminApiKey.isBlank()) {
            log.warn("Administrative request rejected: fail-closed because 'AMBER_ADMIN_API_KEY' is not configured on the server.");
            throw new AdminForbiddenException(
                    "Administrative operations are disabled because no admin API key is configured on the server."
            );
        }

        // Constant-time comparison to prevent side-channel timing attacks
        byte[] expectedBytes = adminApiKey.getBytes(StandardCharsets.UTF_8);
        byte[] providedBytes = providedKey.getBytes(StandardCharsets.UTF_8);

        if (!MessageDigest.isEqual(expectedBytes, providedBytes)) {
            String remoteIp = (request != null) ? request.getRemoteAddr() : "unknown";
            log.warn("Administrative request rejected: invalid administrative key from IP {}", remoteIp);
            throw new AdminForbiddenException("Invalid administrative credentials.");
        }
    }

    public String extractAdminKey(HttpServletRequest request) {
        if (request == null) return null;

        String headerKey = request.getHeader(ADMIN_KEY_HEADER);
        if (headerKey != null && !headerKey.isBlank()) {
            return headerKey.trim();
        }

        String authHeader = request.getHeader(AUTH_HEADER);
        if (authHeader != null && authHeader.regionMatches(true, 0, BEARER_PREFIX, 0, BEARER_PREFIX.length())) {
            return authHeader.substring(BEARER_PREFIX.length()).trim();
        }

        return null;
    }

    public boolean isConfigured() {
        return !adminApiKey.isBlank();
    }
}
