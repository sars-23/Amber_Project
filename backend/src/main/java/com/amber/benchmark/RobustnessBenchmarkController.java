package com.amber.benchmark;

import com.amber.benchmark.dto.BenchmarkResponse;
import com.amber.security.ClientRateLimiter;
import com.amber.security.RateLimitResult;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/benchmark")
public class RobustnessBenchmarkController {

    private final RobustnessBenchmarkService benchmarkService;
    private final ClientRateLimiter rateLimiter;

    public RobustnessBenchmarkController(RobustnessBenchmarkService benchmarkService,
                                         ClientRateLimiter rateLimiter) {
        this.benchmarkService = benchmarkService;
        this.rateLimiter = rateLimiter;
    }

    /**
     * Executes an isolated in-memory acoustic noise robustness benchmark.
     * Uses the uploaded reference audio or built-in 12s multi-tone benchmark track.
     * Enforces per-client rate limiting (max 10 requests / minute) and concurrency guards.
     */
    @PostMapping(value = "/robustness", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> runRobustnessBenchmark(
            @RequestParam(value = "file", required = false) MultipartFile file,
            @RequestParam(value = "snrDb", defaultValue = "20.0") double snrDb,
            @RequestParam(value = "offsetSecs", defaultValue = "2.0") double offsetSecs,
            @RequestParam(value = "durationSecs", defaultValue = "4.0") double durationSecs,
            HttpServletRequest request
    ) {
        // Enforce per-client rate limit
        RateLimitResult rateLimit = rateLimiter.tryAcquire(request);
        if (!rateLimit.isAllowed()) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .header("Retry-After", String.valueOf(rateLimit.getRetryAfterSeconds()))
                    .body(Map.of(
                            "status", HttpStatus.TOO_MANY_REQUESTS.value(),
                            "error", "Too Many Requests",
                            "message", "Rate limit exceeded. Maximum 10 benchmark requests per minute allowed per client. Please retry in " + rateLimit.getRetryAfterSeconds() + " seconds.",
                            "retryAfterSeconds", rateLimit.getRetryAfterSeconds()
                    ));
        }
        try {
            byte[] audioBytes = null;
            String filename = null;

            if (file != null && !file.isEmpty()) {
                if (file.getSize() > RobustnessBenchmarkService.MAX_FILE_SIZE_BYTES) {
                    return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                            .body(Map.of("message", "Uploaded reference audio exceeds the 10 MB limit for benchmarks."));
                }
                audioBytes = file.getBytes();
                filename = file.getOriginalFilename();
            }

            BenchmarkResponse response = benchmarkService.runBenchmark(
                    audioBytes,
                    filename,
                    snrDb,
                    offsetSecs,
                    durationSecs
            );

            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(Map.of("message", e.getMessage()));
        } catch (IOException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "Failed to read reference audio data: " + e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "Benchmark execution failed: " + e.getMessage()));
        }
    }
}
