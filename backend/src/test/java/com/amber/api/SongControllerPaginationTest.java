package com.amber.api;

import com.amber.api.dto.SongResponse;
import com.amber.indexing.SongIndexingService;
import com.amber.song.Song;
import com.amber.song.SongRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.time.Instant;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class SongControllerPaginationTest {

    private SongRepository songRepository;
    private SongIndexingService indexingService;
    private com.amber.security.AdminAuthService adminAuthService;
    private SongController controller;

    @BeforeEach
    void setUp() {
        songRepository = mock(SongRepository.class);
        indexingService = mock(SongIndexingService.class);
        adminAuthService = mock(com.amber.security.AdminAuthService.class);
        controller = new SongController(songRepository, indexingService, adminAuthService);
    }

    @Test
    @DisplayName("Should query repository using page and size pagination parameters")
    void shouldHandlePageAndSizeParameters() {
        Song mockSong = new Song(1L, "Song 1", "Artist 1", 200000, 1500, Instant.now());
        when(songRepository.findAll(20, 20)).thenReturn(List.of(mockSong));

        ResponseEntity<List<SongResponse>> response = controller.listSongs(1, 20, null, null);

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody()).hasSize(1);
        assertThat(response.getBody().get(0).title()).isEqualTo("Song 1");
        verify(songRepository).findAll(20, 20);
    }

    @Test
    @DisplayName("Should support legacy limit and offset query parameters for backwards compatibility")
    void shouldSupportLimitAndOffsetParameters() {
        when(songRepository.findAll(40, 10)).thenReturn(Collections.emptyList());

        ResponseEntity<List<SongResponse>> response = controller.listSongs(null, null, 10, 40);

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody()).isEmpty();
        verify(songRepository).findAll(40, 10);
    }

    @Test
    @DisplayName("Should default to page=0 and size=20 when no query parameters are provided")
    void shouldDefaultPagination() {
        when(songRepository.findAll(0, 20)).thenReturn(Collections.emptyList());

        ResponseEntity<List<SongResponse>> response = controller.listSongs(null, null, null, null);

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        verify(songRepository).findAll(0, 20);
    }
}
