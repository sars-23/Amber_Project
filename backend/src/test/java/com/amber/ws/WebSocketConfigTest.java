package com.amber.ws;

import com.amber.config.WebSocketConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistration;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class WebSocketConfigTest {

    @Test
    @DisplayName("Should register audio stream handler with allowed origin patterns")
    void shouldRegisterAudioStreamHandlerWithOriginPatterns() {
        LiveAudioStreamWebSocketHandler handler = mock(LiveAudioStreamWebSocketHandler.class);
        WebSocketConfig config = new WebSocketConfig(handler);

        WebSocketHandlerRegistry registry = mock(WebSocketHandlerRegistry.class);
        WebSocketHandlerRegistration registration = mock(WebSocketHandlerRegistration.class);

        when(registry.addHandler(eq(handler), eq("/api/v1/ws/audio-stream"))).thenReturn(registration);
        when(registration.setAllowedOriginPatterns(any(String[].class))).thenReturn(registration);

        config.registerWebSocketHandlers(registry);

        verify(registry).addHandler(handler, "/api/v1/ws/audio-stream");
        verify(registration).setAllowedOriginPatterns(any(String[].class));
    }
}
