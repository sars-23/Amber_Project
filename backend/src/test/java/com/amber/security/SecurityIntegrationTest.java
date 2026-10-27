package com.amber.security;

import com.amber.indexing.FingerprintRepository;
import com.amber.indexing.SongIndexingService;
import com.amber.song.Song;
import com.amber.song.SongRepository;
import com.amber.util.SyntheticAudioGenerator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class SecurityIntegrationTest {

    private static final String TEST_ADMIN_KEY = "test-admin-secret-key";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private SongRepository songRepository;

    @Autowired
    private FingerprintRepository fingerprintRepository;

    @Autowired
    private SongIndexingService indexingService;

    @Autowired
    private ClientRateLimiter rateLimiter;

    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        rateLimiter.reset();
    }

    private byte[] createTestWav() throws Exception {
        short[] samples = SyntheticAudioGenerator.generateSineSamples(440.0, 2.0, 11025, 0.8);
        return SyntheticAudioGenerator.createWavFile(samples, 11025);
    }

    @Test
    @DisplayName("Unauthenticated song indexing must be rejected with HTTP 401 Unauthorized")
    void unauthenticatedSongIndexingIsRejected() throws Exception {
        byte[] wavBytes = createTestWav();
        MockMultipartFile file = new MockMultipartFile("file", "unauth.wav", "audio/wav", wavBytes);

        mockMvc.perform(multipart("/api/v1/songs")
                        .file(file)
                        .param("title", "Unauthorized Song")
                        .param("artist", "Hacker"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("Unauthorized"))
                .andExpect(jsonPath("$.message", containsString("Administrative authentication required")));

        boolean found = songRepository.findAll(0, 100).stream()
                .anyMatch(s -> "Unauthorized Song".equals(s.title()));
        assertThat(found).isFalse();
    }

    @Test
    @DisplayName("Invalid administrative credentials must be rejected with HTTP 403 Forbidden")
    void invalidAdministrativeCredentialsAreRejected() throws Exception {
        byte[] wavBytes = createTestWav();
        MockMultipartFile file = new MockMultipartFile("file", "invalid_key.wav", "audio/wav", wavBytes);

        mockMvc.perform(multipart("/api/v1/songs")
                        .file(file)
                        .header("X-Amber-Admin-Key", "wrong-password")
                        .param("title", "Forbidden Song")
                        .param("artist", "Bad Actor"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("Forbidden"))
                .andExpect(jsonPath("$.message", containsString("Invalid administrative credentials")));

        boolean found = songRepository.findAll(0, 100).stream()
                .anyMatch(s -> "Forbidden Song".equals(s.title()));
        assertThat(found).isFalse();
    }

    @Test
    @DisplayName("Authorized administrative writes work as intended with valid credentials")
    void authorizedAdministrativeWritesWork() throws Exception {
        byte[] wavBytes = createTestWav();
        MockMultipartFile file = new MockMultipartFile("file", "authorized.wav", "audio/wav", wavBytes);

        // 1. Index track with valid X-Amber-Admin-Key
        String responseContent = mockMvc.perform(multipart("/api/v1/songs")
                        .file(file)
                        .header("X-Amber-Admin-Key", TEST_ADMIN_KEY)
                        .param("title", "Authorized Song")
                        .param("artist", "Legitimate Admin"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id", notNullValue()))
                .andExpect(jsonPath("$.title").value("Authorized Song"))
                .andReturn().getResponse().getContentAsString();

        JsonNode jsonNode = objectMapper.readTree(responseContent);
        long songId = jsonNode.get("id").asLong();

        assertThat(songRepository.findById(songId)).isPresent();

        // 2. Delete track with valid Authorization: Bearer <key>
        mockMvc.perform(delete("/api/v1/songs/" + songId)
                        .header("Authorization", "Bearer " + TEST_ADMIN_KEY))
                .andExpect(status().isNoContent());

        assertThat(songRepository.findById(songId)).isEmpty();
    }

    @Test
    @DisplayName("Unauthenticated song deletion must be rejected with HTTP 401 and leave data untouched")
    void unauthenticatedSongDeletionIsRejectedWithoutDeleting() throws Exception {
        byte[] wavBytes = createTestWav();
        Song song = indexingService.indexSong("Protected Track", "Catalog Artist", wavBytes, "track.wav");

        mockMvc.perform(delete("/api/v1/songs/" + song.id()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("Unauthorized"));

        // Confirm song was not deleted
        assertThat(songRepository.findById(song.id())).isPresent();
    }

    @Test
    @DisplayName("Benchmark endpoint enforces per-client rate limit of 10 requests per minute with HTTP 429")
    void rateLimitedBenchmarkRequestsReceive429() throws Exception {
        String clientIp = "198.51.100.77";

        // 10 requests within quota should succeed
        for (int i = 1; i <= 10; i++) {
            mockMvc.perform(multipart("/api/v1/benchmark/robustness")
                            .header("X-Forwarded-For", clientIp)
                            .param("snrDb", "25.0")
                            .param("offsetSecs", "1.0")
                            .param("durationSecs", "2.0"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.matched").isBoolean());
        }

        // 11th request must receive HTTP 429 Too Many Requests
        mockMvc.perform(multipart("/api/v1/benchmark/robustness")
                        .header("X-Forwarded-For", clientIp)
                        .param("snrDb", "25.0")
                        .param("offsetSecs", "1.0")
                        .param("durationSecs", "2.0"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.status").value(429))
                .andExpect(jsonPath("$.error").value("Too Many Requests"))
                .andExpect(jsonPath("$.message", containsString("Rate limit exceeded")));

        // Another distinct client IP should still succeed
        mockMvc.perform(multipart("/api/v1/benchmark/robustness")
                        .header("X-Forwarded-For", "198.51.100.88")
                        .param("snrDb", "25.0")
                        .param("offsetSecs", "1.0")
                        .param("durationSecs", "2.0"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("Benchmark requests must never mutate persistent song or fingerprint tables")
    void benchmarkRequestsDoNotMutatePersistentData() throws Exception {
        long songCountBefore = songRepository.count();
        long fingerprintCountBefore = fingerprintRepository.count();

        mockMvc.perform(multipart("/api/v1/benchmark/robustness")
                        .header("X-Forwarded-For", "192.0.2.99")
                        .param("snrDb", "15.0")
                        .param("offsetSecs", "2.0")
                        .param("durationSecs", "3.0"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").isBoolean());

        long songCountAfter = songRepository.count();
        long fingerprintCountAfter = fingerprintRepository.count();

        assertThat(songCountAfter).isEqualTo(songCountBefore);
        assertThat(fingerprintCountAfter).isEqualTo(fingerprintCountBefore);
    }

    @Test
    @DisplayName("Public search and catalog lookup remain publicly accessible without credentials")
    void publicEndpointsRemainAccessible() throws Exception {
        // GET /api/v1/health
        mockMvc.perform(get("/api/v1/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));

        // GET /api/v1/stats
        mockMvc.perform(get("/api/v1/stats"))
                .andExpect(status().isOk());

        // GET /api/v1/songs
        mockMvc.perform(get("/api/v1/songs"))
                .andExpect(status().isOk());

        // POST /api/v1/search
        byte[] wavBytes = createTestWav();
        MockMultipartFile file = new MockMultipartFile("file", "query.wav", "audio/wav", wavBytes);

        mockMvc.perform(multipart("/api/v1/search").file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").isBoolean());
    }

    @Test
    @DisplayName("Unconfigured server admin key must fail closed with 403 Forbidden")
    void unconfiguredServerCredentialFailsClosed() {
        AdminAuthService unconfigured = new AdminAuthService("");
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Amber-Admin-Key", "random-attempt");

        assertThat(unconfigured.isConfigured()).isFalse();
        org.junit.jupiter.api.Assertions.assertThrows(
                AdminForbiddenException.class,
                () -> unconfigured.verifyAdminAccess(request)
        );
    }
}
