package com.echotrace.api;

import com.echotrace.api.dto.HealthResponse;
import com.echotrace.api.dto.StatsResponse;
import com.echotrace.config.AudioProperties;
import com.echotrace.indexing.FingerprintRepository;
import com.echotrace.matching.AudioMatchingService;
import com.echotrace.song.SongRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class StatsController {

    private final SongRepository songRepository;
    private final FingerprintRepository fingerprintRepository;
    private final AudioMatchingService audioMatchingService;
    private final AudioProperties audioProperties;

    public StatsController(SongRepository songRepository,
                           FingerprintRepository fingerprintRepository,
                           AudioMatchingService audioMatchingService,
                           AudioProperties audioProperties) {
        this.songRepository = songRepository;
        this.fingerprintRepository = fingerprintRepository;
        this.audioMatchingService = audioMatchingService;
        this.audioProperties = audioProperties;
    }

    @GetMapping("/health")
    public ResponseEntity<HealthResponse> health() {
        return ResponseEntity.ok(new HealthResponse(
                "UP",
                "1.0.0",
                "CONNECTED",
                audioProperties.getSampleRate(),
                1024,
                512
        ));
    }

    @GetMapping("/stats")
    public ResponseEntity<StatsResponse> stats() {
        long totalSongs = songRepository.count();
        long totalFingerprints = fingerprintRepository.count();
        long totalDurationMs = songRepository.getTotalDurationMs();
        long totalSearches = audioMatchingService.getTotalSearches();
        double avgLatency = Math.round(audioMatchingService.getAverageSearchLatencyMs() * 10.0) / 10.0;

        return ResponseEntity.ok(new StatsResponse(
                totalSongs,
                totalFingerprints,
                totalDurationMs,
                totalSearches,
                avgLatency
        ));
    }
}
