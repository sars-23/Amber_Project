package com.amber.api.dto;

import com.amber.matching.MatchResult;
import com.amber.song.Song;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Collections;

import static org.assertj.core.api.Assertions.assertThat;

class MatchResponseSerializationTest {

    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    @Test
    @DisplayName("Should serialize both canonical processingTimeMs and searchDurationMs, and both matchedFingerprints and matchingHashes")
    void shouldSerializeStandardizedFieldNames() throws Exception {
        Song song = new Song(42L, "Track Name", "Artist Name", 180000, 500, Instant.now());
        MatchResult result = new MatchResult(
                true,
                song,
                1500,
                12.5,
                0.95,
                35,
                120,
                4.25,
                Collections.emptyList()
        );

        MatchResponse response = MatchResponse.from(result);
        String json = objectMapper.writeValueAsString(response);
        JsonNode node = objectMapper.readTree(json);

        // Verify both timing fields are present with identical values
        assertThat(node.has("processingTimeMs")).isTrue();
        assertThat(node.has("searchDurationMs")).isTrue();
        assertThat(node.get("processingTimeMs").asDouble()).isEqualTo(4.25);
        assertThat(node.get("searchDurationMs").asDouble()).isEqualTo(4.25);

        // Verify both hash count fields are present with identical values
        assertThat(node.has("matchedFingerprints")).isTrue();
        assertThat(node.has("matchingHashes")).isTrue();
        assertThat(node.get("matchedFingerprints").asInt()).isEqualTo(35);
        assertThat(node.get("matchingHashes").asInt()).isEqualTo(35);

        assertThat(node.get("matched").asBoolean()).isTrue();
        assertThat(node.get("estimatedOffsetMs").asInt()).isEqualTo(1500);
    }

    @Test
    @DisplayName("Should cleanly serialize no-match response without null pointer exceptions")
    void shouldSerializeNoMatchResponse() throws Exception {
        MatchResult noMatch = MatchResult.noMatch(15, 2.5);
        MatchResponse response = MatchResponse.from(noMatch);

        String json = objectMapper.writeValueAsString(response);
        JsonNode node = objectMapper.readTree(json);

        assertThat(node.get("matched").asBoolean()).isFalse();
        assertThat(node.get("song").isNull()).isTrue();
        assertThat(node.get("confidence").asDouble()).isEqualTo(0.0);
        assertThat(node.get("processingTimeMs").asDouble()).isEqualTo(2.5);
        assertThat(node.get("searchDurationMs").asDouble()).isEqualTo(2.5);
    }
}
