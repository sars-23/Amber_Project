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

    @MockBean
    private OpenMusicImportService openMusicImportService;

    @Test
    @DisplayName("Search endpoint is public and does not require authentication")
    void searchEndpointIsPublic() throws Exception {
        when(openMusicImportService.search(any(), anyInt())).thenReturn(List.of());

        mockMvc.perform(get("/api/v1/open-music/search")
                        .param("q", "rock")
                        .param("limit", "10"))
                .andExpect(status().isOk());
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
}
