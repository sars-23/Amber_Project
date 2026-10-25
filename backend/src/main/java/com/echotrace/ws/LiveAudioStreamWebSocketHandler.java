package com.echotrace.ws;

import com.echotrace.audio.PcmAudio;
import com.echotrace.matching.AudioMatchingService;
import com.echotrace.matching.MatchResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Handles incoming binary PCM stream chunks (16-bit little-endian @ 11,025 Hz mono)
 * from live browser microphone capture and evaluates acoustic matches over a rolling sliding window.
 */
@Component
public class LiveAudioStreamWebSocketHandler extends AbstractWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(LiveAudioStreamWebSocketHandler.class);
    private static final int SAMPLE_RATE = 11025;
    // Rolling query window: 4 seconds = 44,100 samples = 88,200 bytes
    private static final int WINDOW_SAMPLES = SAMPLE_RATE * 4;
    private static final int MIN_RECOGNITION_SAMPLES = SAMPLE_RATE * 2; // Evaluate once we have at least 2 seconds

    private final AudioMatchingService matchingService;
    private final ObjectMapper objectMapper;
    private final Map<String, SessionAudioBuffer> sessions = new ConcurrentHashMap<>();

    public LiveAudioStreamWebSocketHandler(AudioMatchingService matchingService, ObjectMapper objectMapper) {
        this.matchingService = matchingService;
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        log.info("WebSocket audio stream session established: {}", session.getId());
        sessions.put(session.getId(), new SessionAudioBuffer(WINDOW_SAMPLES));
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) throws Exception {
        SessionAudioBuffer buffer = sessions.get(session.getId());
        if (buffer == null) return;

        ByteBuffer byteBuffer = message.getPayload().order(ByteOrder.LITTLE_ENDIAN);
        int shortCount = byteBuffer.remaining() / 2;
        if (shortCount == 0) return;

        short[] samples = new short[shortCount];
        for (int i = 0; i < shortCount; i++) {
            samples[i] = byteBuffer.getShort();
        }

        buffer.append(samples);

        // Periodically run recognition when we have sufficient rolling samples
        if (buffer.shouldEvaluate()) {
            short[] windowSamples = buffer.getRecentSamples();
            PcmAudio queryAudio = new PcmAudio(windowSamples, SAMPLE_RATE);

            MatchResult matchResult = matchingService.matchPcm(queryAudio);

            Map<String, Object> response = new java.util.HashMap<>();
            response.put("type", "MATCH_UPDATE");
            response.put("matched", matchResult.matched());
            response.put("song", matchResult.matched() ? matchResult.song() : null);
            response.put("confidence", matchResult.confidence());
            response.put("estimatedOffsetMs", matchResult.estimatedOffsetMs());
            response.put("matchedFingerprints", matchResult.matchingHashes());
            response.put("totalQueryFingerprints", matchResult.totalQueryFingerprints());
            response.put("processingTimeMs", matchResult.searchDurationMs());

            session.sendMessage(new TextMessage(objectMapper.writeValueAsString(response)));
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload().trim();
        if ("RESET".equalsIgnoreCase(payload)) {
            SessionAudioBuffer buffer = sessions.get(session.getId());
            if (buffer != null) {
                buffer.reset();
            }
            session.sendMessage(new TextMessage("{\"type\":\"RESET_ACK\"}"));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        log.info("WebSocket audio stream session closed: {}, status: {}", session.getId(), status);
        sessions.remove(session.getId());
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        log.error("WebSocket transport error for session: {}", session.getId(), exception);
    }

    /**
     * Thread-safe circular / rolling audio buffer keeping recent samples.
     */
    static class SessionAudioBuffer {
        private final int capacity;
        private final short[] buffer;
        private int writeIndex = 0;
        private int totalAppended = 0;
        private int samplesSinceLastEval = 0;
        private static final int EVAL_INTERVAL = SAMPLE_RATE / 2; // Evaluate every 0.5s of new audio

        public SessionAudioBuffer(int capacity) {
            this.capacity = capacity;
            this.buffer = new short[capacity];
        }

        public synchronized void append(short[] samples) {
            for (short s : samples) {
                buffer[writeIndex] = s;
                writeIndex = (writeIndex + 1) % capacity;
            }
            totalAppended += samples.length;
            samplesSinceLastEval += samples.length;
        }

        public synchronized boolean shouldEvaluate() {
            if (totalAppended >= MIN_RECOGNITION_SAMPLES && samplesSinceLastEval >= EVAL_INTERVAL) {
                samplesSinceLastEval = 0;
                return true;
            }
            return false;
        }

        public synchronized short[] getRecentSamples() {
            int count = Math.min(totalAppended, capacity);
            short[] result = new short[count];
            int start = (totalAppended < capacity) ? 0 : writeIndex;
            for (int i = 0; i < count; i++) {
                result[i] = buffer[(start + i) % capacity];
            }
            return result;
        }

        public synchronized void reset() {
            writeIndex = 0;
            totalAppended = 0;
            samplesSinceLastEval = 0;
        }
    }
}
