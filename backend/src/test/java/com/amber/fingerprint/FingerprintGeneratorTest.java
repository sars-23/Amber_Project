package com.amber.fingerprint;

import com.amber.audio.PcmAudio;
import com.amber.config.AudioProperties;
import com.amber.dsp.SpectralPeakExtractor;
import com.amber.dsp.StftProcessor;
import com.amber.util.SyntheticAudioGenerator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class FingerprintGeneratorTest {

    private FingerprintGenerator generator;

    @BeforeEach
    void setUp() {
        AudioProperties props = new AudioProperties();
        props.setSampleRate(11025);
        StftProcessor stft = new StftProcessor(1024, 512);
        SpectralPeakExtractor extractor = new SpectralPeakExtractor();
        ConstellationBuilder builder = new ConstellationBuilder();
        generator = new FingerprintGenerator(stft, extractor, builder, props);
    }

    @Test
    @DisplayName("Should generate deterministic fingerprints from identical audio signals")
    void testDeterministicFingerprints() {
        short[] samples1 = SyntheticAudioGenerator.generateHarmonicChord(
                new double[]{440.0, 880.0, 1320.0}, 3.0, 11025);
        short[] samples2 = SyntheticAudioGenerator.generateHarmonicChord(
                new double[]{440.0, 880.0, 1320.0}, 3.0, 11025);

        PcmAudio audio1 = new PcmAudio(samples1, 11025);
        PcmAudio audio2 = new PcmAudio(samples2, 11025);

        List<Fingerprint> fps1 = generator.generateFingerprints(audio1);
        List<Fingerprint> fps2 = generator.generateFingerprints(audio2);

        assertThat(fps1).isNotEmpty();
        assertThat(fps1).isEqualTo(fps2);
    }

    @Test
    @DisplayName("Should return empty list for silence or audio shorter than FFT frame size")
    void testSilenceAndShortAudio() {
        // Audio shorter than 1024 samples
        PcmAudio shortAudio = new PcmAudio(new short[500], 11025);
        assertThat(generator.generateFingerprints(shortAudio)).isEmpty();

        // 3 seconds of zero samples
        PcmAudio silentAudio = new PcmAudio(new short[11025 * 3], 11025);
        assertThat(generator.generateFingerprints(silentAudio)).isEmpty();
    }
}
