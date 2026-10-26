package com.amber.config;

import com.amber.ws.LiveAudioStreamWebSocketHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

import java.util.ArrayList;
import java.util.List;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final LiveAudioStreamWebSocketHandler audioStreamHandler;

    @Value("${amber.cors.allowed-origins:http://localhost:3000,http://localhost:5173,https://*.onrender.com,https://amber-frontend-w78m.onrender.com}")
    private String allowedOrigins;

    public WebSocketConfig(LiveAudioStreamWebSocketHandler audioStreamHandler) {
        this.audioStreamHandler = audioStreamHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        List<String> originList = new ArrayList<>();
        if (allowedOrigins != null && !allowedOrigins.isBlank()) {
            for (String origin : allowedOrigins.split(",")) {
                String trimmed = origin.trim();
                if (!trimmed.isEmpty()) {
                    originList.add(trimmed);
                }
            }
        }
        if (!originList.contains("*")) {
            originList.add("*");
        }

        registry.addHandler(audioStreamHandler, "/api/v1/ws/audio-stream")
                .setAllowedOriginPatterns(originList.toArray(String[]::new));
    }
}
