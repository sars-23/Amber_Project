package com.echotrace.api;

import com.echotrace.api.dto.MatchResponse;
import com.echotrace.matching.AudioMatchingService;
import com.echotrace.matching.MatchResult;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

@RestController
@RequestMapping("/api/v1/search")
public class SearchController {

    private final AudioMatchingService audioMatchingService;

    public SearchController(AudioMatchingService audioMatchingService) {
        this.audioMatchingService = audioMatchingService;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<MatchResponse> searchAudio(
            @RequestParam("file") MultipartFile file
    ) throws IOException {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }

        byte[] audioBytes = file.getBytes();
        String filename = file.getOriginalFilename();

        MatchResult result = audioMatchingService.matchAudio(audioBytes, filename);
        return ResponseEntity.ok(MatchResponse.from(result));
    }
}
