package com.amber.openmusic;

import com.amber.indexing.SongIndexingService;
import com.amber.song.Song;
import com.amber.song.SongRepository;
import com.amber.song.SongSourceMetadata;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Optional;

@Component
public class OpenMusicImportWorker {
    private static final Logger log = LoggerFactory.getLogger(OpenMusicImportWorker.class);
    private static final long MAX_AUDIO_BYTES = 25L * 1024 * 1024;
    private static final int COPY_BUFFER_BYTES = 8192;
    private final OpenMusicImportRepository importRepository;
    private final SongRepository songRepository;
    private final SongIndexingService indexingService;
    private final JamendoClient jamendoClient;
    private final HttpClient downloadClient;

    public OpenMusicImportWorker(OpenMusicImportRepository importRepository,
                                 SongRepository songRepository,
                                 SongIndexingService indexingService,
                                 JamendoClient jamendoClient) {
        this.importRepository = importRepository;
        this.songRepository = songRepository;
        this.indexingService = indexingService;
        this.jamendoClient = jamendoClient;
        this.downloadClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    @EventListener(ApplicationReadyEvent.class)
    public void recoverAfterRestart() {
        importRepository.recoverInterruptedJobs();
    }

    @Scheduled(fixedDelayString = "${amber.open-music.worker-delay-ms:3000}")
    public void processOneQueuedTrack() {
        Optional<QueuedImportItem> claimed = importRepository.claimNextPending();
        if (claimed.isEmpty()) return;
        QueuedImportItem item = claimed.get();
        boolean interrupted = false;
        try {
            process(item);
        } catch (Exception ex) {
            interrupted = ex instanceof InterruptedException;
            log.warn("Open music import failed for track id {}: {}", item.externalTrackId(), ex.getMessage());
            importRepository.markItem(item.id(), "FAILED", safeMessage(ex), null, null, null);
        } finally {
            importRepository.refreshJobStatus(item.jobId());
            if (interrupted) Thread.currentThread().interrupt();
        }
    }

    private void process(QueuedImportItem item) throws IOException, InterruptedException {
        // 1. Initial check: has this external track already been indexed?
        Optional<Long> existingSource = songRepository.findIdBySource("jamendo", item.externalTrackId());
        if (existingSource.isPresent()) {
            importRepository.markItem(item.id(), "SKIPPED", "Already indexed from Jamendo.", existingSource.get(), null, null);
            return;
        }

        // 2. Fetch fresh metadata and download URL right before downloading (do not rely on stale URLs)
        Optional<JamendoTrack> freshTrackOpt = jamendoClient.fetchPermittedTrack(item.externalTrackId());
        if (freshTrackOpt.isEmpty()) {
            importRepository.markItem(item.id(), "FAILED",
                    "Track is no longer downloadable or eligible under Amber's supported license policy.",
                    null, null, null);
            return;
        }
        JamendoTrack freshTrack = freshTrackOpt.get();

        Path temporaryAudio = Files.createTempFile("amber-jamendo-", ".mp3");
        String downloadedSha256 = null;
        long downloadedBytes = 0L;
        try {
            // 3. Download audio from fresh URL with strict host validation and 25 MB stream limit
            downloadedBytes = downloadToFile(freshTrack.downloadUrl(), temporaryAudio);
            if (downloadedBytes < 12) {
                throw new IOException("Downloaded file is too small to be valid audio.");
            }
            downloadedSha256 = sha256(temporaryAudio);

            // 4. Duplicate content hash check
            Optional<Long> existingContent = songRepository.findIdByContentSha256(downloadedSha256);
            if (existingContent.isPresent()) {
                importRepository.markItem(item.id(), "SKIPPED", "Identical audio content is already indexed.",
                        existingContent.get(), downloadedBytes, downloadedSha256);
                return;
            }

            // 5. Transactional indexing with existing SongIndexingService
            byte[] audioBytes = Files.readAllBytes(temporaryAudio);
            SongSourceMetadata provenance = new SongSourceMetadata("jamendo", freshTrack.id(),
                    freshTrack.sourceUrl(), freshTrack.licenseUrl(), freshTrack.attributionText(), downloadedSha256);
            Song indexed = indexingService.indexSongFromSource(freshTrack.title(), freshTrack.artist(), audioBytes,
                    safeFilename(freshTrack.id()), provenance);

            importRepository.markItem(item.id(), "IMPORTED", null, indexed.id(), downloadedBytes, downloadedSha256);
        } catch (RuntimeException ex) {
            // A concurrent worker may have indexed this same source or content after our first check.
            Optional<Long> concurrentSource = songRepository.findIdBySource("jamendo", item.externalTrackId());
            if (concurrentSource.isPresent()) {
                importRepository.markItem(item.id(), "SKIPPED", "This Jamendo track was indexed by another import job.",
                        concurrentSource.get(), downloadedBytes > 0 ? downloadedBytes : null, downloadedSha256);
                return;
            }
            if (downloadedSha256 != null) {
                Optional<Long> concurrentContent = songRepository.findIdByContentSha256(downloadedSha256);
                if (concurrentContent.isPresent()) {
                    importRepository.markItem(item.id(), "SKIPPED", "Identical audio content was indexed by another job.",
                            concurrentContent.get(), downloadedBytes > 0 ? downloadedBytes : null, downloadedSha256);
                    return;
                }
            }
            throw ex;
        } finally {
            Files.deleteIfExists(temporaryAudio);
        }
    }

    private long downloadToFile(String firstUrl, Path destination) throws IOException, InterruptedException {
        URI uri;
        try {
            uri = URI.create(firstUrl);
        } catch (IllegalArgumentException ex) {
            throw new IOException("Jamendo returned an invalid download URL.");
        }
        for (int redirectCount = 0; redirectCount <= 4; redirectCount++) {
            validateDownloadUri(uri);
            HttpRequest request = HttpRequest.newBuilder(uri)
                    .timeout(Duration.ofSeconds(90))
                    .header("User-Agent", "Amber-Open-Music-Importer/1.0")
                    .header("Accept", "audio/*, application/octet-stream;q=0.9")
                    .GET().build();
            HttpResponse<InputStream> response = downloadClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
            int status = response.statusCode();
            if (status >= 300 && status < 400) {
                try (InputStream ignored = response.body()) {
                    String location = response.headers().firstValue("Location").orElseThrow(
                            () -> new IOException("Jamendo download redirect omitted its target."));
                    if (redirectCount == 4) throw new IOException("Too many redirects while downloading track.");
                    URI redirectUri;
                    try {
                        redirectUri = uri.resolve(location);
                    } catch (IllegalArgumentException ex) {
                        throw new IOException("Invalid redirect destination: " + location);
                    }
                    validateDownloadUri(redirectUri);
                    uri = redirectUri;
                }
                continue;
            }
            if (status != 200) {
                try (InputStream ignored = response.body()) {
                    throw new IOException("Jamendo download returned HTTP " + status + ".");
                }
            }
            long declaredLength = response.headers().firstValueAsLong("Content-Length").orElse(-1L);
            if (declaredLength > MAX_AUDIO_BYTES) {
                try (InputStream ignored = response.body()) {
                    throw new IOException("Track exceeds the 25 MB per-file import limit.");
                }
            }
            long total = 0;
            try (InputStream input = response.body(); OutputStream output = Files.newOutputStream(destination)) {
                byte[] buffer = new byte[COPY_BUFFER_BYTES];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_AUDIO_BYTES) throw new IOException("Track exceeds the 25 MB per-file import limit.");
                    output.write(buffer, 0, read);
                }
            }
            return total;
        }
        throw new IOException("Unable to resolve Jamendo download URL.");
    }

    public static void validateDownloadUri(URI uri) throws IOException {
        if (uri == null) {
            throw new IOException("Download URL cannot be null.");
        }
        String scheme = uri.getScheme();
        if (!"https".equalsIgnoreCase(scheme)) {
            throw new IOException("Download URL must use HTTPS.");
        }
        int port = uri.getPort();
        if (port != -1 && port != 443) {
            throw new IOException("Download URL must use the default HTTPS port (443). Found port: " + port);
        }
        if (uri.getUserInfo() != null && !uri.getUserInfo().isBlank()) {
            throw new IOException("Download URL contains embedded credentials.");
        }
        if (uri.getRawUserInfo() != null && !uri.getRawUserInfo().isBlank()) {
            throw new IOException("Download URL contains embedded credentials.");
        }
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        if (!isApprovedJamendoHost(host)) {
            throw new IOException("Download URL host '" + host + "' is outside approved Jamendo audio storage hosts.");
        }
    }

    public static boolean isApprovedJamendoHost(String host) {
        if (host == null || host.isBlank()) return false;
        String h = host.toLowerCase(Locale.ROOT);
        return h.equals("storage.jamendo.com")
                || h.endsWith(".storage.jamendo.com")
                || h.equals("usercontent.jamendo.com")
                || h.endsWith(".usercontent.jamendo.com")
                || h.equals("mp3d.jamendo.com")
                || h.endsWith(".mp3d.jamendo.com")
                || h.equals("api.jamendo.com");
    }

    private static String sha256(Path path) throws IOException {
        MessageDigest digest = newDigest();
        try (InputStream input = Files.newInputStream(path)) {
            byte[] buffer = new byte[COPY_BUFFER_BYTES];
            int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    private static MessageDigest newDigest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is unavailable on this JVM.", ex);
        }
    }

    private static String safeFilename(String trackId) {
        return "jamendo-" + trackId + ".mp3";
    }

    private static String safeMessage(Exception ex) {
        String message = ex.getMessage();
        if (message == null || message.isBlank()) return "Import failed. Check the backend logs.";
        return message.length() > 590 ? message.substring(0, 590) : message;
    }
}
