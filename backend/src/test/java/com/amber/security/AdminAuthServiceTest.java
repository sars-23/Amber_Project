package com.amber.security;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AdminAuthServiceTest {

    @Test
    @DisplayName("Should throw AdminUnauthorizedException (401) when no credentials provided")
    void shouldRejectMissingCredentials() {
        AdminAuthService authService = new AdminAuthService("secret-key-123");
        MockHttpServletRequest request = new MockHttpServletRequest();

        assertThatThrownBy(() -> authService.verifyAdminAccess(request))
                .isInstanceOf(AdminUnauthorizedException.class)
                .hasMessageContaining("Administrative authentication required");
    }

    @Test
    @DisplayName("Should fail-closed with AdminForbiddenException (403) when server key is not configured")
    void shouldFailClosedWhenServerKeyNotConfigured() {
        AdminAuthService authService = new AdminAuthService("");
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(AdminAuthService.ADMIN_KEY_HEADER, "attempted-key");

        assertThatThrownBy(() -> authService.verifyAdminAccess(request))
                .isInstanceOf(AdminForbiddenException.class)
                .hasMessageContaining("disabled because no admin API key is configured on the server");
    }

    @Test
    @DisplayName("Should reject invalid credentials with AdminForbiddenException (403)")
    void shouldRejectInvalidCredentials() {
        AdminAuthService authService = new AdminAuthService("correct-secret-456");
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(AdminAuthService.ADMIN_KEY_HEADER, "wrong-secret-999");

        assertThatThrownBy(() -> authService.verifyAdminAccess(request))
                .isInstanceOf(AdminForbiddenException.class)
                .hasMessageContaining("Invalid administrative credentials");
    }

    @Test
    @DisplayName("Should accept valid X-Amber-Admin-Key header")
    void shouldAcceptValidAdminKeyHeader() {
        AdminAuthService authService = new AdminAuthService("correct-secret-456");
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(AdminAuthService.ADMIN_KEY_HEADER, "correct-secret-456");

        assertThatCode(() -> authService.verifyAdminAccess(request))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("Should accept valid Authorization: Bearer <key> header")
    void shouldAcceptValidBearerToken() {
        AdminAuthService authService = new AdminAuthService("bearer-token-789");
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(AdminAuthService.AUTH_HEADER, "Bearer bearer-token-789");

        assertThatCode(() -> authService.verifyAdminAccess(request))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("Should report isConfigured correctly")
    void shouldReportConfigurationStatus() {
        assertThat(new AdminAuthService("some-key").isConfigured()).isTrue();
        assertThat(new AdminAuthService("").isConfigured()).isFalse();
        assertThat(new AdminAuthService(null).isConfigured()).isFalse();
    }
}
