package com.echotrace.indexing;

import com.echotrace.fingerprint.Fingerprint;
import com.echotrace.song.Song;
import com.echotrace.song.SongRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class FingerprintRepositoryTest {

    @Autowired
    private SongRepository songRepository;

    @Autowired
    private FingerprintRepository fingerprintRepository;

    @Test
    @DisplayName("Should batch insert fingerprints and lookup candidates by hashes")
    void testBatchInsertAndLookup() {
        Song song = songRepository.save(new Song("Nocturne Op. 9 No. 2", "Frédéric Chopin", 250000L));

        List<Fingerprint> fingerprints = List.of(
                new Fingerprint(1001, 0, 0, 1),
                new Fingerprint(1002, 500, 10, 15),
                new Fingerprint(1003, 1000, 20, 25),
                new Fingerprint(1004, 1500, 30, 35)
        );

        int inserted = fingerprintRepository.batchInsert(song.id(), fingerprints);
        assertThat(inserted).isEqualTo(4);

        // Lookup candidates by matching hashes
        List<IndexedFingerprint> candidates = fingerprintRepository.findCandidatesByHashes(List.of(1002, 1003, 9999));
        assertThat(candidates).hasSize(2);

        IndexedFingerprint c1 = candidates.stream().filter(c -> c.hash() == 1002).findFirst().orElseThrow();
        assertThat(c1.songId()).isEqualTo(song.id());
        assertThat(c1.anchorTimeMs()).isEqualTo(500);

        IndexedFingerprint c2 = candidates.stream().filter(c -> c.hash() == 1003).findFirst().orElseThrow();
        assertThat(c2.songId()).isEqualTo(song.id());
        assertThat(c2.anchorTimeMs()).isEqualTo(1000);
    }

    @Test
    @DisplayName("Deleting song should cascade delete all associated fingerprints")
    void testCascadeDelete() {
        Song song = songRepository.save(new Song("Canon in D", "Johann Pachelbel", 180000L));

        fingerprintRepository.batchInsert(song.id(), List.of(
                new Fingerprint(5001, 100, 2, 4),
                new Fingerprint(5002, 200, 4, 8)
        ));

        assertThat(fingerprintRepository.findCandidatesByHashes(List.of(5001, 5002))).hasSize(2);

        // Delete the song
        songRepository.deleteById(song.id());

        // Fingerprints must be automatically deleted via foreign key cascade
        assertThat(fingerprintRepository.findCandidatesByHashes(List.of(5001, 5002))).isEmpty();
    }
}
