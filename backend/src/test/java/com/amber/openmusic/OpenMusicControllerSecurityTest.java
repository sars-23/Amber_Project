package com.amber.openmusic;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class OpenMusicControllerSecurityTest {

    private static final String TEST_ADMIN_KEY = "test-admin-secret-key";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private OpenMusicSearchRateLimiter rateLimiter;

    @MockBean
    private OpenMusicImportService openMusicImportService;

    @Test
    @DisplayName("Search endpoint is public and does not require authentication")
    void searchEndpointIsPublic() throws Exception {
        rateLimiter.reset();
        JamendoTrackView trackView = new JamendoTrackView("123", "Song", "Artist", "Album", 120,
                "https://jamendo.com/track/123", "https://creativecommons.org/licenses/by/4.0/",
                "Creative Commons Attribution (CC BY)", "Artist - Song");
        when(openMusicImportService.search(any(), anyInt())).thenReturn(List.of(trackView));

        mockMvc.perform(get("/api/v1/open-music/search")
                        .param("q", "rock")
                        .param("limit", "10"))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$[0].id").value("123"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$[0].downloadUrl").doesNotExist())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$[0].clientId").doesNotExist());
    }

    @Test
    @DisplayName("Search endpoint returns 503 Service Unavailable when Jamendo is unconfigured")
    void searchEndpointReturnsServiceUnavailableWhenUnconfigured() throws Exception {
        rateLimiter.reset();
        when(openMusicImportService.search(any(), anyInt()))
                .thenThrow(new org.springframework.web.server.ResponseStatusException(
                        org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                        "Jamendo search is not configured. Set JAMENDO_CLIENT_ID on the Amber backend."));

        mockMvc.perform(get("/api/v1/open-music/search")
                        .param("q", "rock")
                        .param("limit", "10"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.message")
                        .value("Jamendo search is not configured. Set JAMENDO_CLIENT_ID on the Amber backend."));
    }

    @Test
    @DisplayName("Search endpoint enforces rate limiting with 429 and Retry-After header")
    void searchEndpointEnforcesRateLimit() throws Exception {
        rateLimiter.reset();
        when(openMusicImportService.search(any(), anyInt())).thenReturn(List.of());

        // Exhaust the 30 requests allowed in the window
        for (int i = 0; i < 30; i++) {
            mockMvc.perform(get("/api/v1/open-music/search")
                            .param("q", "ambient")
                            .header("X-Forwarded-For", "203.0.113.195"))
                    .andExpect(status().isOk());
        }

        // 31st request from same IP must receive HTTP 429 Too Many Requests
        mockMvc.perform(get("/api/v1/open-music/search")
                        .param("q", "ambient")
                        .header("X-Forwarded-For", "203.0.113.195"))
                .andExpect(status().isTooManyRequests())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.header().exists("Retry-After"));
    }

    @Test
    @DisplayName("Creating import job requires administrative authentication")
    void createJobRequiresAdmin() throws Exception {
        OpenMusicImportController.CreateImportRequest request =
                new OpenMusicImportController.CreateImportRequest(List.of("12345"));
        String json = objectMapper.writeValueAsString(request);

        // No key -> 401
        mockMvc.perform(post("/api/v1/open-music/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json))
                .andExpect(status().isUnauthorized());

        // Invalid key -> 403
        mockMvc.perform(post("/api/v1/open-music/jobs")
                        .header("X-Amber-Admin-Key", "wrong-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Active jobs retrieval requires administrative authentication")
    void getActiveJobsRequiresAdmin() throws Exception {
        mockMvc.perform(get("/api/v1/open-music/jobs/active"))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/api/v1/open-music/jobs/active")
                        .header("X-Amber-Admin-Key", "wrong-key"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Job status retrieval requires administrative authentication")
    void getJobStatusRequiresAdmin() throws Exception {
        UUID jobId = UUID.randomUUID();

        mockMvc.perform(get("/api/v1/open-music/jobs/" + jobId))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/api/v1/open-music/jobs/" + jobId)
                        .header("Authorization", "Bearer invalid-token"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Retry failed items requires administrative authentication")
    void retryFailedRequiresAdmin() throws Exception {
        UUID jobId = UUID.randomUUID();

        mockMvc.perform(post("/api/v1/open-music/jobs/" + jobId + "/retry-failed"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("Cancel job requires administrative authentication")
    void cancelJobRequiresAdmin() throws Exception {
        UUID jobId = UUID.randomUUID();

        mockMvc.perform(post("/api/v1/open-music/jobs/" + jobId + "/cancel"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("TrackEligibilityException surfaces HTTP 422 with trackId and reasonCode")
    void trackEligibilityExceptionReturnsStructuredError() throws Exception {
        when(openMusicImportService.createJob(any()))
                .thenThrow(new TrackEligibilityException("121711", TrackRejectionReason.DOWNLOAD_NOT_ALLOWED,
                        "Track 121711 cannot be downloaded because the artist has disabled downloads on Jamendo."));

        OpenMusicImportController.CreateImportRequest request =
                new OpenMusicImportController.CreateImportRequest(List.of("121711"));
        String json = objectMapper.writeValueAsString(request);

        mockMvc.perform(post("/api/v1/open-music/jobs")
                        .header("X-Amber-Admin-Key", TEST_ADMIN_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.trackId").value("121711"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.reasonCode").value("DOWNLOAD_NOT_ALLOWED"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.message").value("Track 121711 cannot be downloaded because the artist has disabled downloads on Jamendo."));
    }
}
