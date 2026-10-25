package com.amber.api;

import com.amber.indexing.SongIndexingService;
import com.amber.song.Song;
import com.amber.util.SyntheticAudioGenerator;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ApiControllerIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private SongIndexingService indexingService;

    @Test
    @DisplayName("GET /api/v1/health should return 200 UP")
    void testHealthEndpoint() throws Exception {
        mockMvc.perform(get("/api/v1/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.database").value("CONNECTED"))
                .andExpect(jsonPath("$.sampleRate").value(11025));
    }

    @Test
    @DisplayName("GET /api/v1/stats should return 200 with global counts")
    void testStatsEndpoint() throws Exception {
        mockMvc.perform(get("/api/v1/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalSongs").isNumber())
                .andExpect(jsonPath("$.totalFingerprints").isNumber());
    }

    @Test
    @DisplayName("POST /api/v1/songs and GET /api/v1/songs should index and list track")
    void testUploadAndListSongs() throws Exception {
        short[] samples = SyntheticAudioGenerator.generateHarmonicChord(
                new double[]{440.0, 660.0}, 2.5, 11025);
        byte[] wavBytes = SyntheticAudioGenerator.createWavFile(samples, 11025);

        MockMultipartFile file = new MockMultipartFile(
                "file", "upload_test.wav", "audio/wav", wavBytes);

        mockMvc.perform(multipart("/api/v1/songs")
                        .file(file)
                        .param("title", "REST Symphony")
                        .param("artist", "Spring Composer"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id", notNullValue()))
                .andExpect(jsonPath("$.title").value("REST Symphony"))
                .andExpect(jsonPath("$.fingerprintCount", greaterThan(0)));

        mockMvc.perform(get("/api/v1/songs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(greaterThanOrEqualTo(1))));
    }

    @Test
    @DisplayName("POST /api/v1/search should return matching result for known excerpt")
    void testSearchEndpoint() throws Exception {
        short[] songSamples = SyntheticAudioGenerator.generateMelody(
                new double[]{220.0, 330.0, 440.0, 550.0, 660.0, 880.0}, 1.0, 11025);
        byte[] fullWav = SyntheticAudioGenerator.createWavFile(songSamples, 11025);

        // Index the track
        Song indexed = indexingService.indexSong("Searchable Track", "Search Artist", fullWav, "full.wav");

        // Crop 3 seconds from 1s to 4s (samples 11025 to 44100, true offset = 1000ms)
        short[] cropSamples = new short[11025 * 3];
        System.arraycopy(songSamples, 11025, cropSamples, 0, cropSamples.length);
        byte[] cropWav = SyntheticAudioGenerator.createWavFile(cropSamples, 11025);

        MockMultipartFile queryFile = new MockMultipartFile(
                "file", "query.wav", "audio/wav", cropWav);

        mockMvc.perform(multipart("/api/v1/search")
                        .file(queryFile))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(true))
                .andExpect(jsonPath("$.song.id").value(indexed.id()))
                .andExpect(jsonPath("$.song.title").value("Searchable Track"))
                .andExpect(jsonPath("$.estimatedOffsetMs").value(greaterThanOrEqualTo(900)))
                .andExpect(jsonPath("$.estimatedOffsetMs").value(lessThanOrEqualTo(1100)));
    }
}
