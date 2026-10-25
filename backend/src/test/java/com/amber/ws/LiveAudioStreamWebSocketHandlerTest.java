package com.amber.ws;

import com.amber.audio.PcmAudio;
import com.amber.matching.AudioMatchingService;
import com.amber.matching.MatchResult;
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
        objectMapper = new ObjectMapper();
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
