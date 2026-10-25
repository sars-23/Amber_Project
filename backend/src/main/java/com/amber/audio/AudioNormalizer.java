package com.amber.audio;

import com.amber.config.AudioProperties;
import com.amber.exception.AudioProcessingException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.sound.sampled.*;
import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.*;

@Component
public class AudioNormalizer {

    private static final Logger log = LoggerFactory.getLogger(AudioNormalizer.class);
    private static final int PROCESS_TIMEOUT_SECONDS = 30;

    private final AudioProperties audioProperties;

    public AudioNormalizer(AudioProperties audioProperties) {
        this.audioProperties = audioProperties;
    }

    /**
     * Normalizes arbitrary audio input bytes (WAV, MP3, etc.) into mono signed 16-bit PCM at target sample rate.
     */
    public PcmAudio normalize(byte[] audioBytes, String filenameHint) {
        if (audioBytes == null || audioBytes.length == 0) {
            throw new AudioProcessingException("Input audio bytes are null or empty.");
        }

        // Fast-path: try Java Sound API if it's already a standard WAV matching target sample rate
        try {
            PcmAudio directPcm = tryJavaSoundWav(audioBytes);
            if (directPcm != null) {
                log.debug("Successfully normalized audio via Java Sound fast-path: {} samples", directPcm.getSampleCount());
                return directPcm;
            }
        } catch (Exception e) {
            log.trace("Java Sound direct decode not applicable, falling back to FFmpeg: {}", e.getMessage());
        }

        // Primary path: FFmpeg process execution
        return normalizeViaFfmpeg(audioBytes, filenameHint);
    }

    /**
     * Fast-path decoder for standard uncompressed PCM WAV files.
     */
    private PcmAudio tryJavaSoundWav(byte[] audioBytes) throws UnsupportedAudioFileException, IOException {
        try (ByteArrayInputStream bais = new ByteArrayInputStream(audioBytes);
             AudioInputStream ais = AudioSystem.getAudioInputStream(bais)) {

            AudioFormat format = ais.getFormat();
            int targetRate = audioProperties.getSampleRate();

            // Check if format is already PCM_SIGNED, target sample rate, and mono/stereo
            if (format.getEncoding() == AudioFormat.Encoding.PCM_SIGNED &&
                    Math.abs(format.getSampleRate() - targetRate) < 0.1 &&
                    format.getSampleSizeInBits() == 16) {

                byte[] rawData = ais.readAllBytes();
                if (format.getChannels() == 1) {
                    return PcmAudio.fromLittleEndianBytes(rawData, targetRate);
                } else if (format.getChannels() == 2) {
                    // Downmix stereo to mono
                    return downmixStereoBytes(rawData, targetRate);
                }
            }
        }
        return null;
    }

    private PcmAudio downmixStereoBytes(byte[] stereoBytes, int sampleRate) {
        int numSamples = stereoBytes.length / 4;
        short[] mono = new short[numSamples];
        for (int i = 0; i < numSamples; i++) {
            int left = (stereoBytes[i * 4] & 0xFF) | (stereoBytes[i * 4 + 1] << 8);
            int right = (stereoBytes[i * 4 + 2] & 0xFF) | (stereoBytes[i * 4 + 3] << 8);
            mono[i] = (short) ((left + right) / 2);
        }
        return new PcmAudio(mono, sampleRate);
    }

    /**
     * Resamples and converts arbitrary audio via FFmpeg subprocess.
     */
    private PcmAudio normalizeViaFfmpeg(byte[] audioBytes, String filenameHint) {
        Path tempInput = null;
        Process process = null;
        String extension = extractExtension(filenameHint);

        try {
            tempInput = Files.createTempFile("amber_upload_", extension);
            Files.write(tempInput, audioBytes);

            int targetRate = audioProperties.getSampleRate();
            String ffmpegPath = resolveFfmpegExecutable(audioProperties.getFfmpegPath());

            ProcessBuilder pb = new ProcessBuilder(
                    ffmpegPath,
                    "-hide_banner",
                    "-loglevel", "error",
                    "-nostdin",
                    "-i", tempInput.toAbsolutePath().toString(),
                    "-f", "s16le",
                    "-ac", "1",
                    "-ar", String.valueOf(targetRate),
                    "pipe:1"
            );

            process = pb.start();

            // Read stdout in asynchronous task
            Process finalProcess = process;
            CompletableFuture<byte[]> stdoutFuture = CompletableFuture.supplyAsync(() -> {
                try (InputStream is = finalProcess.getInputStream();
                     ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = is.read(buffer)) != -1) {
                        baos.write(buffer, 0, read);
                    }
                    return baos.toByteArray();
                } catch (IOException e) {
                    throw new CompletionException(e);
                }
            });

            // Read stderr in asynchronous task
            CompletableFuture<String> stderrFuture = CompletableFuture.supplyAsync(() -> {
                try (InputStream es = finalProcess.getErrorStream();
                     BufferedReader reader = new BufferedReader(new InputStreamReader(es))) {
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line).append("\n");
                    }
                    return sb.toString();
                } catch (IOException e) {
                    return "";
                }
            });

            boolean finished = process.waitFor(PROCESS_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                throw new AudioProcessingException("FFmpeg decoding process timed out after " + PROCESS_TIMEOUT_SECONDS + " seconds.");
            }

            int exitCode = process.exitValue();
            String stderr = stderrFuture.get(2, TimeUnit.SECONDS);
            if (exitCode != 0) {
                throw new AudioProcessingException(String.format("FFmpeg process failed with exit code %d: %s", exitCode, stderr));
            }

            byte[] decodedPcmBytes = stdoutFuture.get(2, TimeUnit.SECONDS);
            if (decodedPcmBytes == null || decodedPcmBytes.length == 0) {
                throw new AudioProcessingException("FFmpeg produced empty audio output: " + stderr);
            }

            return PcmAudio.fromLittleEndianBytes(decodedPcmBytes, targetRate);

        } catch (AudioProcessingException ape) {
            throw ape;
        } catch (Exception e) {
            throw new AudioProcessingException("Failed to decode audio file via FFmpeg: " + e.getMessage(), e);
        } finally {
            if (process != null && process.isAlive()) {
                process.destroyForcibly();
            }
            if (tempInput != null) {
                try {
                    Files.deleteIfExists(tempInput);
                } catch (IOException ignored) {
                }
            }
        }
    }

    private String extractExtension(String filename) {
        if (filename != null && filename.contains(".")) {
            String ext = filename.substring(filename.lastIndexOf('.'));
            if (ext.matches("^\\.[a-zA-Z0-9]{1,8}$")) {
                return ext;
            }
        }
        return ".tmp";
    }

    private String resolveFfmpegExecutable(String configuredPath) {
        if (configuredPath != null && !configuredPath.isBlank()) {
            File file = new File(configuredPath);
            if (file.exists() && (file.canExecute() || file.isFile())) {
                return configuredPath;
            }
            if (!configuredPath.contains(File.separator) && !configuredPath.contains("/") && !configuredPath.contains("\\")) {
                return configuredPath;
            }
        }
        String localStremio = "C:\\Users\\rezsi\\AppData\\Local\\Programs\\Stremio\\ffmpeg.exe";
        if (new File(localStremio).exists()) {
            return localStremio;
        }
        return "ffmpeg";
    }
}
