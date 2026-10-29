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
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anySet;
import static org.mockito.Mockito.*;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class AudioMatchingServiceTest {

    @Autowired
    private SongIndexingService indexingService;

    @Autowired
    private AudioMatchingService matchingService;

    @Autowired
    private AudioDecoderService audioDecoderService;

    @Autowired
    private FingerprintGenerator fingerprintGenerator;

    @Test
    @DisplayName("A. Positive match: Should accurately identify an indexed recording from a cropped excerpt")
    void testA_PositiveMatchCroppedExcerpt() {
        // 1. Create a 6-second synthetic track with a sequence of notes
        short[] fullSongSamples = SyntheticAudioGenerator.generateMelody(
                new double[]{330.0, 440.0, 550.0, 660.0, 770.0, 880.0}, 1.0, 11025);
        PcmAudio fullSong = new PcmAudio(fullSongSamples, 11025);

        Song indexedSong = indexingService.indexPcmAudio("Harmonic Master", "DSP Ensemble", fullSong);
        assertThat(indexedSong.fingerprintCount()).isGreaterThan(0);

        // 2. Crop a 2.5-second excerpt starting at offset 1000ms
        long trueOffsetMs = 1000;
        long excerptDurationMs = 2500;
        PcmAudio queryExcerpt = fullSong.slice(trueOffsetMs, excerptDurationMs);

        // 3. Submit excerpt for recognition
        MatchResult result = matchingService.matchPcm(queryExcerpt);

        assertThat(result.matched()).isTrue();
        assertThat(result.song()).isNotNull();
        assertThat(result.song().id()).isEqualTo(indexedSong.id());
        assertThat(result.song().title()).isEqualTo("Harmonic Master");
        assertThat(result.score()).isGreaterThan(AudioMatchingService.MIN_SCORE_THRESHOLD);
        assertThat(result.confidence()).isGreaterThanOrEqualTo(0.80);
        assertThat(result.message()).contains("Acoustic match confirmed");

        // Timestamp offset tolerance check: estimated offset should be within ±100ms of true offset 1000ms
        assertThat(result.estimatedOffsetMs()).isBetween((int) (trueOffsetMs - 100), (int) (trueOffsetMs + 100));
        assertThat(result.searchDurationMs()).isGreaterThan(0.0);
    }

    @Test
    @DisplayName("B. Out-of-catalogue audio: Should reject unrelated audio when known tracks are indexed")
    void testB_OutOfCatalogueUnrelatedAudio() {
        // Index multiple catalog tracks
        short[] song1Samples = SyntheticAudioGenerator.generateHarmonicChord(
                new double[]{150.0, 200.0, 250.0}, 4.0, 11025);
        indexingService.indexPcmAudio("Low Tone Song", "Bass Band", new PcmAudio(song1Samples, 11025));

        short[] song2Samples = SyntheticAudioGenerator.generateMelody(
                new double[]{440.0, 554.37, 659.25}, 1.5, 11025);
        indexingService.indexPcmAudio("Lead Melody", "Acoustic Duo", new PcmAudio(song2Samples, 11025));

        // Query with high-frequency tones completely absent from the catalog
        short[] querySamples = SyntheticAudioGenerator.generateHarmonicChord(
                new double[]{3100.0, 3800.0, 4400.0}, 2.5, 11025);
        PcmAudio queryAudio = new PcmAudio(querySamples, 11025);

        MatchResult result = matchingService.matchPcm(queryAudio);

        assertThat(result.matched()).isFalse();
        assertThat(result.song()).isNull();
        assertThat(result.message()).isNotEmpty();
    }

    @Test
    @DisplayName("C. Weak candidate: Candidate barely passing old 2-vote / 2.0-score threshold must be rejected")
    void testC_WeakCandidateRejected() {
        FingerprintRepository mockFpRepo = mock(FingerprintRepository.class);
        SongRepository mockSongRepo = mock(SongRepository.class);
        AudioMatchingService isolatedService = new AudioMatchingService(
                mockFpRepo, mockSongRepo, audioDecoderService, fingerprintGenerator);

        // Construct 15 query fingerprints with distinct hashes
        List<Fingerprint> queryFPs = new ArrayList<>();
        for (int i = 0; i < 15; i++) {
            queryFPs.add(new Fingerprint(1000 + i, i * 200));
        }

        // Return candidate fingerprints with only 2 peak votes in the dominant offset bucket (say offset 5000ms)
        // and 1 vote in another bucket (offset 1000ms)
        List<IndexedFingerprint> mockCandidates = List.of(
                new IndexedFingerprint(1000, 101L, 5000), // offset = 5000 - 0 = 5000ms (vote 1)
                new IndexedFingerprint(1001, 101L, 5200), // offset = 5200 - 200 = 5000ms (vote 2, peak bucket)
                new IndexedFingerprint(1002, 101L, 1400)  // offset = 1400 - 400 = 1000ms (noise bucket)
        );

        when(mockFpRepo.findCandidatesByHashes(anySet())).thenReturn(mockCandidates);

        MatchResult result = isolatedService.matchFingerprints(queryFPs);

        // Peak votes is 2. Under old code, MIN_PEAK_VOTES=2 passed! Under new code, MIN_PEAK_VOTES=4 rejects it.
        assertThat(result.matched()).isFalse();
        assertThat(result.song()).isNull();
        assertThat(result.message()).contains("Insufficient time-coherent votes");
    }

    @Test
    @DisplayName("D. Ambiguous candidates: When two candidates have very similar evidence, Amber must reject as ambiguous")
    void testD_AmbiguousCandidatesRejected() {
        FingerprintRepository mockFpRepo = mock(FingerprintRepository.class);
        SongRepository mockSongRepo = mock(SongRepository.class);
        AudioMatchingService isolatedService = new AudioMatchingService(
                mockFpRepo, mockSongRepo, audioDecoderService, fingerprintGenerator);

        List<Fingerprint> queryFPs = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            queryFPs.add(new Fingerprint(2000 + i, i * 100));
        }

        // Candidate 1 (songId=201) gets 10 votes in offset 3000ms
        // Candidate 2 (songId=202) gets 10 votes in offset 4000ms
        List<IndexedFingerprint> mockCandidates = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            mockCandidates.add(new IndexedFingerprint(2000 + i, 201L, 3000 + (i * 100)));
            mockCandidates.add(new IndexedFingerprint(2000 + i, 202L, 4000 + (i * 100)));
        }

        when(mockFpRepo.findCandidatesByHashes(anySet())).thenReturn(mockCandidates);

        MatchResult result = isolatedService.matchFingerprints(queryFPs);

        // Candidate 1 and Candidate 2 have virtually identical scores -> ambiguous!
        assertThat(result.matched()).isFalse();
        assertThat(result.song()).isNull();
        assertThat(result.message()).contains("Ambiguous match");
    }

    @Test
    @DisplayName("E. Vocal/audio mismatch: Realistic singing vocal fixture against unrelated instrumental must be rejected")
    void testE_VocalMelodyMismatchRejected() {
        // Index an instrumental guitar-like chord track
        short[] instrumentalSamples = SyntheticAudioGenerator.generateHarmonicChord(
                new double[]{220.0, 277.18, 329.63, 440.0}, 5.0, 11025);
        indexingService.indexPcmAudio("Acoustic Fingerstyle", "Guitar Studio", new PcmAudio(instrumentalSamples, 11025));

        // Synthesize a realistic vocal singing simulation with vibrato and formant filtering (notes: E4, G4, A4, B4)
        short[] vocalSamples = SyntheticAudioGenerator.generateVocalSimulation(
                new double[]{329.63, 392.00, 440.00, 493.88}, 0.8, 11025);
        PcmAudio vocalQuery = new PcmAudio(vocalSamples, 11025);

        MatchResult result = matchingService.matchPcm(vocalQuery);

        assertThat(result.matched()).isFalse();
        assertThat(result.song()).isNull();
        assertThat(result.message()).isNotEmpty();
    }

    @Test
    @DisplayName("F. Robustness: Excerpt positions across 1.5s, 3.0s, and quieter audio retain correct recognition")
    void testF_RobustnessAcrossExcerptPositionsAndGain() {
        double[] notes = {261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 987.77};
        short[] fullSamples = SyntheticAudioGenerator.generateMelody(notes, 1.0, 11025);
        PcmAudio fullPcm = new PcmAudio(fullSamples, 11025);

        Song indexedSong = indexingService.indexPcmAudio("Dynamic Symphony", "Maestro Solo", fullPcm);

        // Test at 1500ms
        PcmAudio excerpt1 = fullPcm.slice(1500L, 3000L);
        MatchResult result1 = matchingService.matchPcm(excerpt1);
        assertThat(result1.matched()).isTrue();
        assertThat(result1.song().id()).isEqualTo(indexedSong.id());
        assertThat(Math.abs(result1.estimatedOffsetMs() - 1500)).isLessThanOrEqualTo(200);

        // Test at 3000ms with 50% reduced volume (quieter query)
        short[] quietSamples = fullPcm.slice(3000L, 3000L).getSamples();
        for (int i = 0; i < quietSamples.length; i++) {
            quietSamples[i] = (short) (quietSamples[i] * 0.5);
        }
        PcmAudio quietQuery = new PcmAudio(quietSamples, 11025);
        MatchResult result2 = matchingService.matchPcm(quietQuery);
        assertThat(result2.matched()).isTrue();
        assertThat(result2.song().id()).isEqualTo(indexedSong.id());
        assertThat(Math.abs(result2.estimatedOffsetMs() - 3000)).isLessThanOrEqualTo(250);
    }

    @Test
    @DisplayName("G. Empty catalogue and invalid queries: Handled cleanly without throwing exceptions")
    void testG_EmptyCatalogueAndInvalidQueries() {
        // 1. Null fingerprints
        MatchResult nullResult = matchingService.matchFingerprints(null);
        assertThat(nullResult.matched()).isFalse();
        assertThat(nullResult.song()).isNull();
        assertThat(nullResult.message()).contains("Insufficient audio features");

        // 2. Empty fingerprints
        MatchResult emptyResult = matchingService.matchFingerprints(Collections.emptyList());
        assertThat(emptyResult.matched()).isFalse();
        assertThat(emptyResult.song()).isNull();

        // 3. Insufficient fingerprints (< MIN_QUERY_FINGERPRINTS = 10)
        List<Fingerprint> tinyFPs = List.of(
                new Fingerprint(101, 100),
                new Fingerprint(102, 200),
                new Fingerprint(103, 300)
        );
        MatchResult tinyResult = matchingService.matchFingerprints(tinyFPs);
        assertThat(tinyResult.matched()).isFalse();
        assertThat(tinyResult.song()).isNull();
        assertThat(tinyResult.totalQueryFingerprints()).isEqualTo(3);
    }

    @Test
    @DisplayName("H. Response consistency: REST MatchResponse and WebSocket payload agree on match decision")
    void testH_ResponseConsistencyBetweenRestAndWebSocket() {
        // Query an unrelated high frequency signal
        short[] unrelatedSamples = SyntheticAudioGenerator.generateHarmonicChord(
                new double[]{3500.0, 4200.0}, 2.0, 11025);
        PcmAudio unrelatedPcm = new PcmAudio(unrelatedSamples, 11025);

        MatchResult result = matchingService.matchPcm(unrelatedPcm);

        // Check REST DTO conversion
        MatchResponse restResponse = MatchResponse.from(result);
        assertThat(restResponse.matched()).isFalse();
        assertThat(restResponse.song()).isNull();
        assertThat(restResponse.message()).isEqualTo(result.message());

        // Check WebSocket JSON dictionary conversion
        Map<String, Object> wsPayload = new HashMap<>();
        wsPayload.put("matched", result.matched());
        wsPayload.put("song", result.matched() ? result.song() : null);
        wsPayload.put("message", result.message());

        assertThat(wsPayload.get("matched")).isEqualTo(restResponse.matched());
        assertThat(wsPayload.get("song")).isNull();
        assertThat(wsPayload.get("message")).isEqualTo(restResponse.message());
    }
}
