package com.amber.config;

import com.amber.ws.LiveAudioStreamWebSocketHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final LiveAudioStreamWebSocketHandler audioStreamHandler;

    public WebSocketConfig(LiveAudioStreamWebSocketHandler audioStreamHandler) {
        this.audioStreamHandler = audioStreamHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(audioStreamHandler, "/api/v1/ws/audio-stream")
                .setAllowedOrigins("*");
    }
}
