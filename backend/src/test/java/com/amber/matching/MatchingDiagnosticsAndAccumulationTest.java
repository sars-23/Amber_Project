package com.amber.matching;

import com.amber.api.dto.MatchResponse;
import com.amber.audio.AudioDecoderService;
import com.amber.audio.PcmAudio;
import com.amber.fingerprint.Fingerprint;
import com.amber.fingerprint.FingerprintGenerator;
import com.amber.indexing.FingerprintRepository;
import com.amber.indexing.IndexedFingerprint;
import com.amber.indexing.SongIndexingService;
import com.amber.song.Song;
import com.amber.song.SongRepository;
import com.amber.util.SyntheticAudioGenerator;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anySet;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class MatchingDiagnosticsAndAccumulationTest {

    @Autowired
    private SongIndexingService indexingService;

    @Autowired
    private AudioMatchingService matchingService;

    @Autowired
    private AudioDecoderService audioDecoderService;

    @Autowired
    private FingerprintGenerator fingerprintGenerator;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    @DisplayName("1. Repeated query hashes at distinct timestamps produce separate offset votes without duplicate bucket inflation")
    void testRepeatedQueryHashesAtDistinctTimestamps() {
        FingerprintRepository mockFpRepo = mock(FingerprintRepository.class);
        SongRepository mockSongRepo = mock(SongRepository.class);
        AudioMatchingService isolatedService = new AudioMatchingService(
                mockFpRepo, mockSongRepo, audioDecoderService, fingerprintGenerator);

        // Query has repeated hash 5001 at two different query timestamps (t=100 and t=500)
        List<Fingerprint> queryFPs = new ArrayList<>();
        queryFPs.add(new Fingerprint(5001, 100));
        queryFPs.add(new Fingerprint(5001, 500));
        for (int i = 0; i < 15; i++) {
            queryFPs.add(new Fingerprint(6000 + i, 1000 + i * 50));
        }

        // Database song has hash 5001 at anchor time 1100ms
        // Offsets: 1100 - 100 = 1000ms; 1100 - 500 = 600ms
        List<IndexedFingerprint> mockCandidates = List.of(
                new IndexedFingerprint(5001, 101L, 1100)
        );

        when(mockFpRepo.findCandidatesByHashes(anySet())).thenReturn(mockCandidates);

        MatchResult result = isolatedService.matchFingerprints(queryFPs);

        assertThat(result.diagnostics()).isNotNull();
        assertThat(result.diagnostics().candidateFingerprintRows()).isEqualTo(1);
        assertThat(result.diagnostics().candidateSongs()).isEqualTo(1);
        // Candidate 101 was supported by two distinct query points: (5001, 100) and (5001, 500)
        assertThat(result.diagnostics().totalWinningVotes()).isEqualTo(2);
        // Each bucket has at most 1 distinct query point vote
        assertThat(result.diagnostics().winningPeakVotes()).isEqualTo(1);
    }

    @Test
    @DisplayName("2. Exact duplicate query fingerprints are deduplicated and cannot vote multiple times")
    void testExactDuplicateQueryFingerprints() {
        FingerprintRepository mockFpRepo = mock(FingerprintRepository.class);
        SongRepository mockSongRepo = mock(SongRepository.class);
        AudioMatchingService isolatedService = new AudioMatchingService(
                mockFpRepo, mockSongRepo, audioDecoderService, fingerprintGenerator);

        // Query contains an exact duplicate: (5001, 100) appears twice
        List<Fingerprint> queryFPs = new ArrayList<>();
        queryFPs.add(new Fingerprint(5001, 100));
        queryFPs.add(new Fingerprint(5001, 100)); // Exact duplicate
        for (int i = 0; i < 15; i++) {
            queryFPs.add(new Fingerprint(6000 + i, 500 + i * 50));
        }

        List<IndexedFingerprint> mockCandidates = List.of(
                new IndexedFingerprint(5001, 201L, 1100) // offset = 1000ms
        );

        when(mockFpRepo.findCandidatesByHashes(anySet())).thenReturn(mockCandidates);

        MatchResult result = isolatedService.matchFingerprints(queryFPs);

        assertThat(result.diagnostics()).isNotNull();
        // The duplicate query timestamp is deduplicated so peak votes is strictly 1
        assertThat(result.diagnostics().winningPeakVotes()).isEqualTo(1);
        assertThat(result.diagnostics().totalWinningVotes()).isEqualTo(1);
    }

    @Test
    @DisplayName("3. Repeated indexed hashes at distinct timestamps contribute to distinct buckets without multiplying candidate support")
    void testRepeatedIndexedHashesAtDistinctTimestamps() {
        FingerprintRepository mockFpRepo = mock(FingerprintRepository.class);
        SongRepository mockSongRepo = mock(SongRepository.class);
        AudioMatchingService isolatedService = new AudioMatchingService(
                mockFpRepo, mockSongRepo, audioDecoderService, fingerprintGenerator);

        List<Fingerprint> queryFPs = new ArrayList<>();
        queryFPs.add(new Fingerprint(7000, 0));
        queryFPs.add(new Fingerprint(7001, 100));
        queryFPs.add(new Fingerprint(7002, 200));
        for (int i = 3; i < 15; i++) {
            queryFPs.add(new Fingerprint(7000 + i, i * 100));
        }

        // Database song has repeated hashes across different song timestamps
        // Hash 7000 appears at 1000ms, 5000ms, and 8000ms
        List<IndexedFingerprint> mockCandidates = List.of(
                new IndexedFingerprint(7000, 301L, 1000), // offset = 1000 - 0 = 1000ms
                new IndexedFingerprint(7000, 301L, 5000), // offset = 5000 - 0 = 5000ms
                new IndexedFingerprint(7000, 301L, 8000), // offset = 8000 - 0 = 8000ms
                new IndexedFingerprint(7001, 301L, 1100), // offset = 1100 - 100 = 1000ms
                new IndexedFingerprint(7002, 301L, 1200)  // offset = 1200 - 200 = 1000ms
        );

        when(mockFpRepo.findCandidatesByHashes(anySet())).thenReturn(mockCandidates);

        MatchResult result = isolatedService.matchFingerprints(queryFPs);

        assertThat(result.diagnostics()).isNotNull();
        assertThat(result.diagnostics().candidateFingerprintRows()).isEqualTo(5);
        assertThat(result.diagnostics().candidateSongs()).isEqualTo(1);
        // Dominant peak bucket (offset 1000ms) has 3 distinct query points (from 7000, 7001, 7002)
        assertThat(result.diagnostics().winningPeakVotes()).isEqualTo(3);
        // Unique query support is 3 (only 3 distinct query points matched this candidate)
        assertThat(result.diagnostics().totalWinningVotes()).isEqualTo(3);
        // Raw pairwise matches before deduplication is 5
        assertThat(result.diagnostics().rawPairwiseVotes()).isEqualTo(5);
    }

    @Test
    @DisplayName("4. Exact duplicate database fingerprint rows are deduplicated and cannot inflate votes")
    void testExactDuplicateDatabaseFingerprintRows() {
        FingerprintRepository mockFpRepo = mock(FingerprintRepository.class);
        SongRepository mockSongRepo = mock(SongRepository.class);
        AudioMatchingService isolatedService = new AudioMatchingService(
                mockFpRepo, mockSongRepo, audioDecoderService, fingerprintGenerator);

        List<Fingerprint> queryFPs = new ArrayList<>();
        queryFPs.add(new Fingerprint(8000, 1000));
        for (int i = 1; i < 15; i++) {
            queryFPs.add(new Fingerprint(8000 + i, 1000 + i * 50));
        }

        // Database repository returns duplicate rows for the same fingerprint
        List<IndexedFingerprint> mockCandidates = List.of(
                new IndexedFingerprint(8000, 401L, 2000), // offset = 1000ms
                new IndexedFingerprint(8000, 401L, 2000)  // duplicate row
        );

        when(mockFpRepo.findCandidatesByHashes(anySet())).thenReturn(mockCandidates);

        MatchResult result = isolatedService.matchFingerprints(queryFPs);

        assertThat(result.diagnostics()).isNotNull();
        // Deduplicated candidate fingerprint rows
        assertThat(result.diagnostics().candidateFingerprintRows()).isEqualTo(1);
        assertThat(result.diagnostics().winningPeakVotes()).isEqualTo(1);
        assertThat(result.diagnostics().totalWinningVotes()).isEqualTo(1);
    }

    @Test
    @DisplayName("5. One query occurrence matching multiple database occurrences is bounded to 1 vote per bucket and 1 total query support")
    void testOneQueryOccurrenceMatchingMultipleDatabaseOccurrences() {
        FingerprintRepository mockFpRepo = mock(FingerprintRepository.class);
        SongRepository mockSongRepo = mock(SongRepository.class);
        AudioMatchingService isolatedService = new AudioMatchingService(
                mockFpRepo, mockSongRepo, audioDecoderService, fingerprintGenerator);

        // Single query fingerprint for hash 9000
        List<Fingerprint> queryFPs = new ArrayList<>();
        queryFPs.add(new Fingerprint(9000, 500));
        for (int i = 1; i < 15; i++) {
            queryFPs.add(new Fingerprint(9100 + i, 1000 + i * 50));
        }

        // Candidate song 501 has repeated pattern: hash 9000 at 5 different timestamps
        List<IndexedFingerprint> mockCandidates = List.of(
                new IndexedFingerprint(9000, 501L, 1000),
                new IndexedFingerprint(9000, 501L, 2000),
                new IndexedFingerprint(9000, 501L, 3000),
                new IndexedFingerprint(9000, 501L, 4000),
                new IndexedFingerprint(9000, 501L, 5000)
        );

        when(mockFpRepo.findCandidatesByHashes(anySet())).thenReturn(mockCandidates);

        MatchResult result = isolatedService.matchFingerprints(queryFPs);

        assertThat(result.diagnostics()).isNotNull();
        // Raw pairwise combinations is 5
        assertThat(result.diagnostics().rawPairwiseVotes()).isEqualTo(5);
        // Unique query support for this candidate is strictly 1 (only 1 query point matched)
        assertThat(result.diagnostics().totalWinningVotes()).isEqualTo(1);
        // Each bucket has at most 1 vote
        assertThat(result.diagnostics().winningPeakVotes()).isEqualTo(1);
    }

    @Test
    @DisplayName("6. Correct distinct-query support in dominant offset bucket and accurate coherence ratio")
    void testCorrectDistinctQuerySupportInDominantOffsetBucket() {
        FingerprintRepository mockFpRepo = mock(FingerprintRepository.class);
        SongRepository mockSongRepo = mock(SongRepository.class);
        AudioMatchingService isolatedService = new AudioMatchingService(
                mockFpRepo, mockSongRepo, audioDecoderService, fingerprintGenerator);

        List<Fingerprint> queryFPs = new ArrayList<>();
        // 6 query points aligned at offset 1500ms
        for (int i = 0; i < 6; i++) {
            queryFPs.add(new Fingerprint(9200 + i, 1000 + i * 100));
        }
        // 10 scattered query points
        for (int i = 6; i < 16; i++) {
            queryFPs.add(new Fingerprint(9200 + i, 1000 + i * 100));
        }

        List<IndexedFingerprint> mockCandidates = new ArrayList<>();
        // 6 points in candidate 601 at offset 1500ms (database time = query time + 1500)
        for (int i = 0; i < 6; i++) {
            mockCandidates.add(new IndexedFingerprint(9200 + i, 601L, 2500 + i * 100));
        }
        // 10 scattered points in candidate 601 at random offsets
        for (int i = 6; i < 16; i++) {
            mockCandidates.add(new IndexedFingerprint(9200 + i, 601L, 10000 + i * 1000));
        }

        when(mockFpRepo.findCandidatesByHashes(anySet())).thenReturn(mockCandidates);

        MatchResult result = isolatedService.matchFingerprints(queryFPs);

        assertThat(result.diagnostics()).isNotNull();
        assertThat(result.diagnostics().winningPeakVotes()).isEqualTo(6);
        assertThat(result.diagnostics().totalWinningVotes()).isEqualTo(16);
        // Coherence ratio = 6 / 16 = 0.375
        assertThat(result.diagnostics().coherenceRatio()).isEqualTo(0.375);
    }

    @Test
    @DisplayName("7. Positive recognition despite repeated hashes using synthetic audio")
    void testPositiveMatchingAndHistogramConstruction() {
        short[] fullSongSamples = SyntheticAudioGenerator.generateMelody(
                new double[]{261.63, 329.63, 392.0, 523.25, 659.25, 783.99}, 1.2, 11025);
        PcmAudio fullSong = new PcmAudio(fullSongSamples, 11025);

        Song indexedSong = indexingService.indexPcmAudio("Diagnostic Test Track", "Amber DSP", fullSong);
        assertThat(indexedSong.id()).isNotNull();

        // Slice excerpt at offset 1200ms
        long trueOffsetMs = 1200;
        PcmAudio queryExcerpt = fullSong.slice(trueOffsetMs, 2500);

        MatchResult result = matchingService.matchPcm(queryExcerpt);

        assertThat(result.matched()).isTrue();
        assertThat(result.song()).isNotNull();
        assertThat(result.song().id()).isEqualTo(indexedSong.id());
        assertThat(result.diagnostics()).isNotNull();
        assertThat(result.diagnostics().rejectionGate()).isEqualTo("NONE");
        assertThat(result.diagnostics().winningSongId()).isEqualTo(indexedSong.id());
        assertThat(result.diagnostics().winningSongTitle()).isEqualTo("Diagnostic Test Track");
        assertThat(result.diagnostics().winningPeakVotes()).isGreaterThanOrEqualTo(4);
        assertThat(result.diagnostics().topBuckets()).isNotEmpty();
        assertThat(Math.abs(result.estimatedOffsetMs() - trueOffsetMs)).isLessThanOrEqualTo(150);
    }

    @Test
    @DisplayName("8. Unrelated audio rejection: Random noise is rejected with diagnostics")
    void testUnrelatedAudioRejectionWithDiagnostics() {
        Random rand = new Random(42);
        short[] noiseSamples = new short[11025 * 3];
        for (int i = 0; i < noiseSamples.length; i++) {
            noiseSamples[i] = (short) (rand.nextGaussian() * 4000);
        }
        PcmAudio noiseAudio = new PcmAudio(noiseSamples, 11025);

        MatchResult result = matchingService.matchPcm(noiseAudio);

        assertThat(result.matched()).isFalse();
        assertThat(result.song()).isNull();
        assertThat(result.diagnostics()).isNotNull();
        assertThat(result.diagnostics().rejectionGate()).isNotEqualTo("NONE");
    }

    @Test
    @DisplayName("9. Ambiguous candidates remain safely rejected at GATE_4_AMBIGUITY")
    void testAmbiguousCandidatesRemainRejected() {
        FingerprintRepository mockFpRepo = mock(FingerprintRepository.class);
        SongRepository mockSongRepo = mock(SongRepository.class);
        AudioMatchingService isolatedService = new AudioMatchingService(
                mockFpRepo, mockSongRepo, audioDecoderService, fingerprintGenerator);

        Song song1 = new Song(701L, "Candidate Song 1", "Artist A", 180000L, 500, Instant.now());
        Song song2 = new Song(702L, "Candidate Song 2", "Artist B", 180000L, 500, Instant.now());
        when(mockSongRepo.findById(701L)).thenReturn(Optional.of(song1));
        when(mockSongRepo.findById(702L)).thenReturn(Optional.of(song2));

        List<Fingerprint> queryFPs = new ArrayList<>();
        List<IndexedFingerprint> mockCandidates = new ArrayList<>();

        // Generate 12 query fingerprints
        for (int i = 0; i < 12; i++) {
            int hash = 9500 + i;
            queryFPs.add(new Fingerprint(hash, i * 100));
            // Both song 701 and song 702 have identical coherent alignment at offset 1000ms
            mockCandidates.add(new IndexedFingerprint(hash, 701L, 1000 + i * 100));
            mockCandidates.add(new IndexedFingerprint(hash, 702L, 1000 + i * 100));
        }

        when(mockFpRepo.findCandidatesByHashes(anySet())).thenReturn(mockCandidates);

        MatchResult result = isolatedService.matchFingerprints(queryFPs);

        assertThat(result.matched()).isFalse();
        assertThat(result.song()).isNull();
        assertThat(result.diagnostics()).isNotNull();
        assertThat(result.diagnostics().rejectionGate()).isEqualTo("GATE_4_AMBIGUITY");
        // Safe metadata exposure: leading rejected candidate title and artist are exposed in diagnostics
        assertThat(result.diagnostics().winningSongTitle()).isNotNull();
        assertThat(result.diagnostics().winningSongArtist()).isNotNull();
    }

    @Test
    @DisplayName("10. Realistic production fixture: 720 query FPs, repeated hashes, passes coherence gate with independent query support")
    void testRealisticProductionFixtureWithRepeatedHashes() {
        FingerprintRepository mockFpRepo = mock(FingerprintRepository.class);
        SongRepository mockSongRepo = mock(SongRepository.class);
        AudioMatchingService isolatedService = new AudioMatchingService(
                mockFpRepo, mockSongRepo, audioDecoderService, fingerprintGenerator);

        Song song34 = new Song(34L, "Ed_Sheeran_-_Sapphire_(Official_Music_Video)", "Ed Sheeran", 183287L, 90040, Instant.now());
        when(mockSongRepo.findById(34L)).thenReturn(Optional.of(song34));

        // Create 720 query fingerprints across 648 distinct hashes (matching production evidence)
        List<Fingerprint> queryFPs = new ArrayList<>(720);
        for (int i = 0; i < 648; i++) {
            queryFPs.add(new Fingerprint(10000 + i, i * 15));
        }
        for (int i = 0; i < 72; i++) {
            queryFPs.add(new Fingerprint(10000 + i, 10000 + i * 15)); // repeated hashes at different times
        }

        List<IndexedFingerprint> mockCandidates = new ArrayList<>();

        // True candidate (Song ID 34):
        // 31 distinct query points match in the dominant offset bucket at offset 2000ms
        for (int i = 0; i < 31; i++) {
            int hash = 10000 + i;
            int qTime = i * 15;
            mockCandidates.add(new IndexedFingerprint(hash, 34L, 2000 + qTime));
        }

        // 169 other distinct query points match at scattered background timestamps
        for (int i = 31; i < 200; i++) {
            int hash = 10000 + i;
            mockCandidates.add(new IndexedFingerprint(hash, 34L, 50000 + i * 100));
        }

        // Song 34 is a full-length track with 90k fingerprints: repeated hashes create 5,000 extra pairwise occurrences
        for (int i = 0; i < 200; i++) {
            int hash = 10000 + i;
            for (int r = 1; r <= 25; r++) {
                mockCandidates.add(new IndexedFingerprint(hash, 34L, 80000 + r * 1000 + i * 5));
            }
        }

        // Add 10 background noise candidate songs with 5 random hits each
        for (long noiseId = 100L; noiseId < 110L; noiseId++) {
            for (int i = 0; i < 5; i++) {
                mockCandidates.add(new IndexedFingerprint(10300 + i, noiseId, 1000 + i * 500));
            }
        }

        when(mockFpRepo.findCandidatesByHashes(anySet())).thenReturn(mockCandidates);

        MatchResult result = isolatedService.matchFingerprints(queryFPs);

        assertThat(result.diagnostics()).isNotNull();
        assertThat(result.diagnostics().winningSongId()).isEqualTo(34L);
        assertThat(result.diagnostics().winningSongTitle()).isEqualTo("Ed_Sheeran_-_Sapphire_(Official_Music_Video)");
        assertThat(result.diagnostics().winningPeakVotes()).isEqualTo(31);

        // Unique query support is 272 (200 hashes, 72 of which had 2 query timestamps each: 72*2 + 128 = 272)
        // This is strictly bounded by query features, rather than 5,000+ Cartesian combinations!
        assertThat(result.diagnostics().totalWinningVotes()).isEqualTo(272);
        assertThat(result.diagnostics().rawPairwiseVotes()).isGreaterThan(5000);

        // Coherence ratio: 31 / 272 = 0.114 (11.4%) -> WELL ABOVE 5% MIN_COHERENCE_RATIO_THRESHOLD!
        assertThat(result.diagnostics().coherenceRatio()).isGreaterThanOrEqualTo(0.05);

        // Crucial verification: GATE_3_COHERENCE_RATIO is NOT triggered!
        assertThat(result.diagnostics().rejectionGate()).isNotEqualTo("GATE_3_COHERENCE_RATIO");

        // Song is successfully recognized!
        assertThat(result.matched()).isTrue();
        assertThat(result.song()).isNotNull();
        assertThat(result.song().id()).isEqualTo(34L);
        assertThat(result.song().title()).isEqualTo("Ed_Sheeran_-_Sapphire_(Official_Music_Video)");
    }

    @Test
    @DisplayName("11. REST and WebSocket consistency: Same PCM audio produces identical results and diagnostics")
    void testRestAndWebSocketConsistencyUsingSamePcm() throws Exception {
        short[] testSamples = SyntheticAudioGenerator.generateHarmonicChord(
                new double[]{440.0, 554.37, 659.25}, 2.0, 11025);
        PcmAudio queryAudio = new PcmAudio(testSamples, 11025);

        MatchResult result = matchingService.matchPcm(queryAudio);

        // 1. REST MatchResponse
        MatchResponse restResponse = MatchResponse.from(result);

        // 2. WebSocket dictionary payload
        Map<String, Object> wsPayload = new LinkedHashMap<>();
        wsPayload.put("type", "MATCH_UPDATE");
        wsPayload.put("matched", result.matched());
        wsPayload.put("song", result.matched() ? result.song() : null);
        wsPayload.put("confidence", result.confidence());
        wsPayload.put("estimatedOffsetMs", result.estimatedOffsetMs());
        wsPayload.put("matchedFingerprints", result.matchingHashes());
        wsPayload.put("matchingHashes", result.matchingHashes());
        wsPayload.put("totalQueryFingerprints", result.totalQueryFingerprints());
        wsPayload.put("processingTimeMs", result.searchDurationMs());
        wsPayload.put("searchDurationMs", result.searchDurationMs());
        wsPayload.put("message", result.message());
        wsPayload.put("diagnostics", result.diagnostics());

        String wsJson = objectMapper.writeValueAsString(wsPayload);
        Map<?, ?> parsedWs = objectMapper.readValue(wsJson, Map.class);

        assertThat(restResponse.matched()).isEqualTo(parsedWs.get("matched"));
        assertThat(restResponse.totalQueryFingerprints()).isEqualTo(parsedWs.get("totalQueryFingerprints"));
        assertThat(restResponse.matchingHashes()).isEqualTo(parsedWs.get("matchingHashes"));
        assertThat(restResponse.message()).isEqualTo(parsedWs.get("message"));

        if (result.matched()) {
            assertThat(restResponse.song()).isNotNull();
            assertThat(parsedWs.get("song")).isNotNull();
        } else {
            assertThat(restResponse.song()).isNull();
            assertThat(parsedWs.get("song")).isNull();
        }

        assertThat(parsedWs.get("diagnostics")).isNotNull();
    }
}
