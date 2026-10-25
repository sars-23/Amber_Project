package com.amber.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "amber.audio")
public class AudioProperties {

    private int sampleRate = 11025;
    private String ffmpegPath = "ffmpeg";
    private int maxDurationSeconds = 600;
    private int minDurationSeconds = 1;
    private long maxFileSizeBytes = 26214400; // 25 MB

    public int getSampleRate() {
        return sampleRate;
    }

    public void setSampleRate(int sampleRate) {
        this.sampleRate = sampleRate;
    }

    public String getFfmpegPath() {
        return ffmpegPath;
    }

    public void setFfmpegPath(String ffmpegPath) {
        this.ffmpegPath = ffmpegPath;
    }

    public int getMaxDurationSeconds() {
        return maxDurationSeconds;
    }

    public void setMaxDurationSeconds(int maxDurationSeconds) {
        this.maxDurationSeconds = maxDurationSeconds;
    }

    public int getMinDurationSeconds() {
        return minDurationSeconds;
    }

    public void setMinDurationSeconds(int minDurationSeconds) {
        this.minDurationSeconds = minDurationSeconds;
    }

    public long getMaxFileSizeBytes() {
        return maxFileSizeBytes;
    }

    public void setMaxFileSizeBytes(long maxFileSizeBytes) {
        this.maxFileSizeBytes = maxFileSizeBytes;
    }
}
