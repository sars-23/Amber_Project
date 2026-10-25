package com.amber.song;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class SongRepositoryTest {

    @Autowired
    private SongRepository songRepository;

    @Test
    @DisplayName("Should save a song, retrieve by ID, and update fingerprint count")
    void testSaveAndFind() {
        Song song = new Song("Clair de Lune", "Claude Debussy", 312000L);
        Song saved = songRepository.save(song);

        assertThat(saved.id()).isNotNull();
        assertThat(saved.title()).isEqualTo("Clair de Lune");
        assertThat(saved.artist()).isEqualTo("Claude Debussy");
        assertThat(saved.durationMs()).isEqualTo(312000L);

        Optional<Song> retrieved = songRepository.findById(saved.id());
        assertThat(retrieved).isPresent();
        assertThat(retrieved.get().title()).isEqualTo("Clair de Lune");

        songRepository.updateFingerprintCount(saved.id(), 1540);
        Optional<Song> updated = songRepository.findById(saved.id());
        assertThat(updated).isPresent();
        assertThat(updated.get().fingerprintCount()).isEqualTo(1540);
    }

    @Test
    @DisplayName("Should list paginated songs and delete correctly")
    void testListAndDelete() {
        songRepository.save(new Song("Track 1", "Artist A", 100000L));
        songRepository.save(new Song("Track 2", "Artist B", 200000L));

        List<Song> all = songRepository.findAll(0, 10);
        assertThat(all.size()).isGreaterThanOrEqualTo(2);

        Song first = all.get(0);
        boolean deleted = songRepository.deleteById(first.id());
        assertThat(deleted).isTrue();

        assertThat(songRepository.findById(first.id())).isEmpty();
    }
}
