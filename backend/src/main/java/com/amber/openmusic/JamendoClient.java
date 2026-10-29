package com.amber.openmusic;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
public class JamendoClient {
    private static final String API_BASE = "https://api.jamendo.com/v3.0/tracks/";
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;
    private final String clientId;

    @org.springframework.beans.factory.annotation.Autowired
    public JamendoClient(ObjectMapper objectMapper,
                         @Value("${amber.jamendo.client-id:}") String clientId) {
        this(objectMapper, clientId, HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build());
    }

    public JamendoClient(ObjectMapper objectMapper, String clientId, HttpClient httpClient) {
        this.objectMapper = objectMapper;
        this.clientId = clientId == null ? "" : clientId.trim();
        this.httpClient = httpClient;
    }

    public boolean isConfigured() {
        return !clientId.isBlank();
    }

    public List<JamendoTrack> search(String query, int limit) {
        requireConfigured();
        String trimmed = query == null ? "" : query.trim();
        if (trimmed.length() < 2 || trimmed.length() > 100) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Search must contain 2–100 characters.");
        }
        String url = API_BASE + "?client_id=" + encode(clientId)
                + "&format=json&limit=" + Math.max(1, Math.min(limit, 25))
                + "&search=" + encode(trimmed)
                + "&type=single+albumtrack&audioformat=mp32&audiodlformat=mp32";
        return parsePermittedTracks(getJson(url));
    }

    public JamendoTrack requirePermittedTrack(String id) {
        return requirePermittedTracks(List.of(id)).get(0);
    }

    /**
     * Fetches a single track fresh from Jamendo immediately before processing.
     * Returns empty if track not found or no longer permitted under license / download policy.
     */
    public Optional<JamendoTrack> fetchPermittedTrack(String id) {
        requireConfigured();
        if (id == null || !id.matches("[0-9]{1,20}")) {
            return Optional.empty();
        }
        String url = API_BASE + "?client_id=" + encode(clientId) + "&format=json&limit=1&id=" + encode(id) + "&id[]=" + encode(id)
                + "&type=single+albumtrack&audioformat=mp32&audiodlformat=mp32";
        try {
            List<JamendoTrack> tracks = verifyTrackList(List.of(id), getJson(url));
            return tracks.stream().findFirst();
        } catch (TrackEligibilityException ex) {
            return Optional.empty();
        }
    }

    /** Revalidates an entire selected batch in one Jamendo request rather than trusting browser metadata. */
    public List<JamendoTrack> requirePermittedTracks(List<String> ids) {
        requireConfigured();
        if (ids == null || ids.isEmpty() || ids.size() > 25
                || ids.stream().anyMatch(id -> id == null || !id.matches("[0-9]{1,20}"))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid Jamendo track IDs.");
        }
        StringBuilder idParams = new StringBuilder();
        for (int i = 0; i < ids.size(); i++) {
            if (i > 0) idParams.append("&");
            idParams.append("id[]=").append(encode(ids.get(i)));
        }
        if (ids.size() == 1) {
            idParams.append("&id=").append(encode(ids.get(0)));
        }
        String url = API_BASE + "?client_id=" + encode(clientId) + "&format=json&limit=" + Math.max(25, ids.size())
                + "&" + idParams
                + "&type=single+albumtrack&audioformat=mp32&audiodlformat=mp32";
        return verifyTrackList(ids, getJson(url));
    }

    public List<JamendoTrack> verifyTrackList(List<String> ids, JsonNode root) {
        JsonNode resultsNode = root.path("results");
        Map<String, JsonNode> rawTracksById = new HashMap<>();
        if (resultsNode.isArray()) {
            for (JsonNode item : resultsNode) {
                String id = text(item, "id");
                if (!id.isBlank()) {
                    rawTracksById.put(id, item);
                }
            }
        }

        List<JamendoTrack> verified = new ArrayList<>();
        for (String id : ids) {
            JsonNode item = rawTracksById.get(id);
            if (item == null) {
                throw new TrackEligibilityException(id, TrackRejectionReason.TRACK_NOT_RETURNED,
                        "Track " + id + " was not found on Jamendo.");
            }

            String title = text(item, "name");
            String artist = text(item, "artist_name");
            if (title.isBlank() || artist.isBlank()) {
                throw new TrackEligibilityException(id, TrackRejectionReason.INVALID_METADATA,
                        "Track " + id + " is missing required title or artist metadata.");
            }

            boolean downloadAllowed = item.path("audiodownload_allowed").asBoolean(false);
            if (!downloadAllowed) {
                throw new TrackEligibilityException(id, TrackRejectionReason.DOWNLOAD_NOT_ALLOWED,
                        "Track " + id + " cannot be downloaded because the artist has disabled downloads on Jamendo.");
            }

            String downloadUrl = text(item, "audiodownload");
            if (downloadUrl.isBlank()) {
                throw new TrackEligibilityException(id, TrackRejectionReason.DOWNLOAD_URL_MISSING,
                        "Track " + id + " does not provide an audio download URL.");
            }

            String licenseUrl = text(item, "license_ccurl");
            if (!JamendoLicensePolicy.isImportAllowed(licenseUrl)) {
                String displayedLicense = licenseUrl.isBlank() ? "none" : licenseUrl;
                throw new TrackEligibilityException(id, TrackRejectionReason.UNSUPPORTED_LICENSE,
                        "Track " + id + " has license '" + displayedLicense + "', which is not eligible. Only CC BY and CC BY-SA licenses are supported.");
            }

            String sourceUrl = text(item, "shareurl");
            if (sourceUrl.isBlank()) sourceUrl = "https://www.jamendo.com/track/" + id;
            int duration = Math.max(0, item.path("duration").asInt(0));
            String album = text(item, "album_name");
            String attribution = artist + " — " + title + "; source: " + sourceUrl + "; license: " + licenseUrl;
            verified.add(new JamendoTrack(id, title, artist, album, duration, downloadUrl, sourceUrl, licenseUrl, attribution));
        }

        return verified;
    }

    private void requireConfigured() {
        if (!isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Jamendo search is not configured. Set JAMENDO_CLIENT_ID on the Amber backend.");
        }
    }

    private JsonNode getJson(String url) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(20))
                    .header("Accept", "application/json")
                    .header("User-Agent", "Amber-Open-Music-Importer/1.0")
                    .GET().build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() == 429) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                        "Jamendo rate-limited the request. Wait a moment and try again.");
            }
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "Jamendo API returned HTTP " + response.statusCode() + ".");
            }
            JsonNode root = objectMapper.readTree(response.body());
            String apiStatus = root.path("headers").path("status").asText("success");
            if (!"success".equalsIgnoreCase(apiStatus)) {
                String errorMsg = root.path("headers").path("error_message").asText("Jamendo API reported an unsuccessful response.");
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, errorMsg);
            }
            return root;
        } catch (ResponseStatusException ex) {
            throw ex;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Interrupted while contacting Jamendo.", ex);
        } catch (IOException | IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Unable to read Jamendo API response.", ex);
        }
    }

    private List<JamendoTrack> parsePermittedTracks(JsonNode root) {
        JsonNode results = root.path("results");
        List<JamendoTrack> tracks = new ArrayList<>();
        if (!results.isArray()) return tracks;
        for (JsonNode item : results) {
            String id = text(item, "id");
            String title = text(item, "name");
            String artist = text(item, "artist_name");
            String downloadUrl = text(item, "audiodownload");
            String licenseUrl = text(item, "license_ccurl");
            boolean downloadAllowed = item.path("audiodownload_allowed").asBoolean(false);
            if (id.isBlank() || title.isBlank() || artist.isBlank() || !downloadAllowed
                    || downloadUrl.isBlank() || !JamendoLicensePolicy.isImportAllowed(licenseUrl)) {
                continue;
            }
            String sourceUrl = text(item, "shareurl");
            if (sourceUrl.isBlank()) sourceUrl = "https://www.jamendo.com/track/" + id;
            int duration = Math.max(0, item.path("duration").asInt(0));
            String album = text(item, "album_name");
            String attribution = artist + " — " + title + "; source: " + sourceUrl + "; license: " + licenseUrl;
            tracks.add(new JamendoTrack(id, title, artist, album, duration, downloadUrl, sourceUrl, licenseUrl, attribution));
        }
        return tracks;
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? "" : value.asText("").trim();
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
