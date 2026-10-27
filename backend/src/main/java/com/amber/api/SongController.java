package com.amber.api;

import com.amber.api.dto.SongResponse;
import com.amber.indexing.SongIndexingService;
import com.amber.song.Song;
import com.amber.song.SongRepository;
import com.amber.security.AdminAuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

@RestController
@RequestMapping("/api/v1/songs")
public class SongController {

    private final SongRepository songRepository;
    private final SongIndexingService songIndexingService;
    private final AdminAuthService adminAuthService;

    public SongController(SongRepository songRepository,
                          SongIndexingService songIndexingService,
                          AdminAuthService adminAuthService) {
        this.songRepository = songRepository;
        this.songIndexingService = songIndexingService;
        this.adminAuthService = adminAuthService;
    }

    @GetMapping
    public ResponseEntity<List<SongResponse>> listSongs(
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset
    ) {
        int effectiveLimit = 20;
        if (size != null && size > 0) {
            effectiveLimit = Math.min(100, size);
        } else if (limit != null && limit > 0) {
            effectiveLimit = Math.min(100, limit);
        }

        int effectiveOffset = 0;
        if (offset != null && offset >= 0) {
            effectiveOffset = offset;
        } else if (page != null && page >= 0) {
            effectiveOffset = page * effectiveLimit;
        }

        List<Song> songs = songRepository.findAll(effectiveOffset, effectiveLimit);
        List<SongResponse> response = songs.stream().map(SongResponse::from).toList();
        return ResponseEntity.ok(response);
    }

    @GetMapping("/{id}")
    public ResponseEntity<SongResponse> getSong(@PathVariable Long id) {
        return songRepository.findById(id)
                .map(song -> ResponseEntity.ok(SongResponse.from(song)))
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<SongResponse> uploadAndIndex(
            @RequestParam("file") MultipartFile file,
            @RequestParam("title") String title,
            @RequestParam("artist") String artist,
            HttpServletRequest request
    ) throws IOException {
        adminAuthService.verifyAdminAccess(request);

        if (file.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }

        byte[] audioBytes = file.getBytes();
        String filename = file.getOriginalFilename();

        Song indexed = songIndexingService.indexSong(title, artist, audioBytes, filename);
        return ResponseEntity.status(HttpStatus.CREATED).body(SongResponse.from(indexed));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteSong(@PathVariable Long id, HttpServletRequest request) {
        adminAuthService.verifyAdminAccess(request);

        boolean deleted = songRepository.deleteById(id);
        return deleted ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }
}
