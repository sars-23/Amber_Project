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

import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
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
    @DisplayName("1. Duplicate query fingerprints: Multiple identical hashes and duplicate query timestamps are handled cleanly")
    void testDuplicateQueryFingerprints() {
        FingerprintRepository mockFpRepo = mock(FingerprintRepository.class);
        SongRepository mockSongRepo = mock(SongRepository.class);
        AudioMatchingService isolatedService = new AudioMatchingService(
                mockFpRepo, mockSongRepo, audioDecoderService, fingerprintGenerator);

        // Build query fingerprints with intentional duplicates (same hash at same and different anchor times)
        List<Fingerprint> queryFPs = new ArrayList<>();
        queryFPs.add(new Fingerprint(5001, 100));
        queryFPs.add(new Fingerprint(5001, 100)); // Exact duplicate
        queryFPs.add(new Fingerprint(5001, 300)); // Repeated hash, different timestamp
        for (int i = 0; i < 15; i++) {
            queryFPs.add(new Fingerprint(6000 + i, 500 + i * 50));
        }

        when(mockFpRepo.findCandidatesByHashes(anySet())).thenReturn(Collections.emptyList());

        MatchResult result = isolatedService.matchFingerprints(queryFPs);

        assertThat(result.matched()).isFalse();
        assertThat(result.diagnostics()).isNotNull();
        assertThat(result.diagnostics().queryFingerprints()).isEqualTo(queryFPs.size());
        assertThat(result.diagnostics().distinctQueryHashes()).isLessThan(queryFPs.size());
        assertThat(result.diagnostics().rejectionGate()).isEqualTo("NO_CANDIDATES");
    }

    @Test
    @DisplayName("2. Repeated database fingerprint rows: Candidate vote accumulation handles multi-timestamp occurrences")
    void testRepeatedDatabaseFingerprintRows() {
        FingerprintRepository mockFpRepo = mock(FingerprintRepository.class);
        SongRepository mockSongRepo = mock(SongRepository.class);
        AudioMatchingService isolatedService = new AudioMatchingService(
                mockFpRepo, mockSongRepo, audioDecoderService, fingerprintGenerator);

        List<Fingerprint> queryFPs = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
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
        // Dominant peak bucket (offset 1000ms) has 3 votes (from 7000, 7001, 7002)
        assertThat(result.diagnostics().winningPeakVotes()).isEqualTo(3);
        // Total winner votes includes the scattered occurrences at 5000ms and 8000ms (total = 5)
        assertThat(result.diagnostics().totalWinningVotes()).isEqualTo(5);
    }

    @Test
    @DisplayName("3. Correct offset histogram construction: Positive match with synthetic audio")
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
        assertThat(result.diagnostics().winningPeakVotes()).isGreaterThanOrEqualTo(4);
        assertThat(result.diagnostics().topBuckets()).isNotEmpty();
        assertThat(Math.abs(result.estimatedOffsetMs() - trueOffsetMs)).isLessThanOrEqualTo(150);
    }

    @Test
    @DisplayName("4. Unrelated audio rejection: Unrelated white noise is rejected with diagnostics")
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
    @DisplayName("5. REST and WebSocket consistency: Same PCM audio produces identical results and diagnostics")
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
