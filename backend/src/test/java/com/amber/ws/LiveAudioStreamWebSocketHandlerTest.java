package com.amber.ws;

import com.amber.audio.PcmAudio;
import com.amber.matching.AudioMatchingService;
import com.amber.matching.MatchResult;
import com.amber.song.Song;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.time.Instant;
import java.util.Collections;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class LiveAudioStreamWebSocketHandlerTest {

    private AudioMatchingService matchingService;
    private ObjectMapper objectMapper;
    private LiveAudioStreamWebSocketHandler handler;
    private WebSocketSession session;

    @BeforeEach
    void setUp() {
        matchingService = mock(AudioMatchingService.class);
        objectMapper = new ObjectMapper().findAndRegisterModules();
        handler = new LiveAudioStreamWebSocketHandler(matchingService, objectMapper);
        session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("test-session-1");
    }

    @Test
    @DisplayName("Should accept binary PCM frames and trigger evaluation once rolling threshold is met")
    void shouldAcceptBinaryPcmAndEvaluate() throws Exception {
        handler.afterConnectionEstablished(session);

        when(matchingService.matchPcm(any(PcmAudio.class)))
                .thenReturn(MatchResult.noMatch(10, 5.0));

        // Send 2.5 seconds of 11,025 Hz 16-bit PCM (27,563 shorts = 55,126 bytes)
        int sampleCount = 27563;
        ByteBuffer buffer = ByteBuffer.allocate(sampleCount * 2).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < sampleCount; i++) {
            buffer.putShort((short) (Math.sin(2 * Math.PI * 440 * i / 11025) * 16000));
        }
        buffer.flip();

        BinaryMessage binaryMessage = new BinaryMessage(buffer);
        handler.handleBinaryMessage(session, binaryMessage);

        ArgumentCaptor<TextMessage> textCaptor = ArgumentCaptor.forClass(TextMessage.class);
        verify(session, atLeastOnce()).sendMessage(textCaptor.capture());

        String jsonResponse = textCaptor.getValue().getPayload();
        assertThat(jsonResponse).contains("\"type\":\"MATCH_UPDATE\"");
        assertThat(jsonResponse).contains("\"confidence\":0.0");
    }

    @Test
    @DisplayName("Should stream standard 4,096-byte frames and trigger evaluation once 2.0s buffer accumulates")
    void shouldStreamStandard4096ByteFrames() throws Exception {
        handler.afterConnectionEstablished(session);

        when(matchingService.matchPcm(any(PcmAudio.class)))
                .thenReturn(MatchResult.noMatch(6, 4.0));

        // 4,096 bytes = 2,048 samples of 16-bit PCM
        int samplesPerFrame = 2048;
        // 11 frames * 2048 samples = 22,528 samples (> 22,050 samples = 2.0s threshold)
        for (int frame = 0; frame < 11; frame++) {
            ByteBuffer frameBuffer = ByteBuffer.allocate(samplesPerFrame * 2).order(ByteOrder.LITTLE_ENDIAN);
            for (int s = 0; s < samplesPerFrame; s++) {
                frameBuffer.putShort((short) 500);
            }
            frameBuffer.flip();
            handler.handleBinaryMessage(session, new BinaryMessage(frameBuffer));
        }

        ArgumentCaptor<TextMessage> textCaptor = ArgumentCaptor.forClass(TextMessage.class);
        verify(session, atLeastOnce()).sendMessage(textCaptor.capture());

        JsonNode responseNode = objectMapper.readTree(textCaptor.getValue().getPayload());
        assertThat(responseNode.get("type").asText()).isEqualTo("MATCH_UPDATE");
        assertThat(responseNode.get("matched").asBoolean()).isFalse();
        assertThat(responseNode.has("processingTimeMs")).isTrue();
        assertThat(responseNode.has("searchDurationMs")).isTrue();
    }

    @Test
    @DisplayName("Should accept and process maximum supported 60KB binary frame in one message")
    void shouldAcceptLargeBinaryFrame() throws Exception {
        handler.afterConnectionEstablished(session);

        Song mockSong = new Song(99L, "Matched Title", "Matched Artist", 180000, 2000, Instant.now());
        when(matchingService.matchPcm(any(PcmAudio.class)))
                .thenReturn(new MatchResult(true, mockSong, 2500, 15.0, 0.92, 45, 150, 8.5, Collections.emptyList()));

        // 60,000 bytes = 30,000 samples (within 64 KB buffer limit)
        int samples = 30000;
        ByteBuffer buffer = ByteBuffer.allocate(samples * 2).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < samples; i++) {
            buffer.putShort((short) 1000);
        }
        buffer.flip();

        handler.handleBinaryMessage(session, new BinaryMessage(buffer));

        ArgumentCaptor<TextMessage> textCaptor = ArgumentCaptor.forClass(TextMessage.class);
        verify(session, atLeastOnce()).sendMessage(textCaptor.capture());

        JsonNode responseNode = objectMapper.readTree(textCaptor.getValue().getPayload());
        assertThat(responseNode.get("type").asText()).isEqualTo("MATCH_UPDATE");
        assertThat(responseNode.get("matched").asBoolean()).isTrue();
        assertThat(responseNode.get("song").get("title").asText()).isEqualTo("Matched Title");
        assertThat(responseNode.get("estimatedOffsetMs").asInt()).isEqualTo(2500);
        assertThat(responseNode.get("processingTimeMs").asDouble()).isEqualTo(8.5);
        assertThat(responseNode.get("searchDurationMs").asDouble()).isEqualTo(8.5);
        assertThat(responseNode.get("matchedFingerprints").asInt()).isEqualTo(45);
        assertThat(responseNode.get("matchingHashes").asInt()).isEqualTo(45);
    }

    @Test
    @DisplayName("Should acknowledge RESET text message and clear buffer")
    void shouldAcknowledgeReset() throws Exception {
        handler.afterConnectionEstablished(session);

        TextMessage resetMessage = new TextMessage("RESET");
        handler.handleTextMessage(session, resetMessage);

        ArgumentCaptor<TextMessage> textCaptor = ArgumentCaptor.forClass(TextMessage.class);
        verify(session).sendMessage(textCaptor.capture());

        assertThat(textCaptor.getValue().getPayload()).contains("RESET_ACK");
    }
}
