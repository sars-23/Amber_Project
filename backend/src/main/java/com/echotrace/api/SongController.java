package com.echotrace.api;

import com.echotrace.api.dto.SongResponse;
import com.echotrace.indexing.SongIndexingService;
import com.echotrace.song.Song;
import com.echotrace.song.SongRepository;
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

    public SongController(SongRepository songRepository, SongIndexingService songIndexingService) {
        this.songRepository = songRepository;
        this.songIndexingService = songIndexingService;
    }

    @GetMapping
    public ResponseEntity<List<SongResponse>> listSongs(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        int offset = Math.max(0, page) * Math.min(100, Math.max(1, size));
        List<Song> songs = songRepository.findAll(offset, Math.min(100, Math.max(1, size)));
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
            @RequestParam("artist") String artist
    ) throws IOException {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }

        byte[] audioBytes = file.getBytes();
        String filename = file.getOriginalFilename();

        Song indexed = songIndexingService.indexSong(title, artist, audioBytes, filename);
        return ResponseEntity.status(HttpStatus.CREATED).body(SongResponse.from(indexed));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteSong(@PathVariable Long id) {
        boolean deleted = songRepository.deleteById(id);
        return deleted ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }
}
