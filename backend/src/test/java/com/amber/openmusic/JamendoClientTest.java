package com.amber.openmusic;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class JamendoClientTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Mock
    private HttpClient mockHttpClient;

    @Mock
    private HttpResponse<String> mockResponse;

    private JamendoClient client;

    @BeforeEach
    void setUp() {
        client = new JamendoClient(objectMapper, "test-client-id", mockHttpClient);
    }

    private void mockApiResponse(int statusCode, String jsonBody) throws IOException, InterruptedException {
        when(mockResponse.statusCode()).thenReturn(statusCode);
        when(mockResponse.body()).thenReturn(jsonBody);
        when(mockHttpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
                .thenReturn(mockResponse);
    }

    @Test
    @DisplayName("Successful track revalidation with CC BY-SA license, audio download allowed, and valid download URL")
    void testSuccessfulTrackRevalidation() throws Exception {
        String json = """
            {
              "headers": { "status": "success", "code": 0 },
              "results": [
                {
                  "id": "121711",
                  "name": "Old Pal",
                  "artist_name": "Zack David",
                  "album_name": "Winds of Change",
                  "duration": 162,
                  "audiodownload": "https://storage.jamendo.com/download/track/121711/mp32/",
                  "audiodownload_allowed": true,
                  "license_ccurl": "http://creativecommons.org/licenses/by-sa/3.0/",
                  "shareurl": "https://www.jamendo.com/track/121711"
                }
              ]
            }
            """;
        mockApiResponse(200, json);

        List<JamendoTrack> tracks = client.requirePermittedTracks(List.of("121711"));
        assertEquals(1, tracks.size());
        JamendoTrack track = tracks.get(0);
        assertEquals("121711", track.id());
        assertEquals("Old Pal", track.title());
        assertEquals("Zack David", track.artist());
        assertEquals("Winds of Change", track.album());
        assertEquals("http://creativecommons.org/licenses/by-sa/3.0/", track.licenseUrl());
        assertEquals("https://storage.jamendo.com/download/track/121711/mp32/", track.downloadUrl());
        assertTrue(track.attributionText().contains("CC BY-SA") || track.attributionText().contains("3.0"));
    }

    @Test
    @DisplayName("Track where artist disabled downloads throws TrackEligibilityException with DOWNLOAD_NOT_ALLOWED")
    void testDownloadDisabledByArtist() throws Exception {
        String json = """
            {
              "headers": { "status": "success", "code": 0 },
              "results": [
                {
                  "id": "121711",
                  "name": "Old Pal",
                  "artist_name": "Zack David",
                  "audiodownload": "https://storage.jamendo.com/download/track/121711/mp32/",
                  "audiodownload_allowed": false,
                  "license_ccurl": "http://creativecommons.org/licenses/by-sa/3.0/"
                }
              ]
            }
            """;
        mockApiResponse(200, json);

        TrackEligibilityException ex = assertThrows(TrackEligibilityException.class,
                () -> client.requirePermittedTracks(List.of("121711")));
        assertEquals("121711", ex.getTrackId());
        assertEquals(TrackRejectionReason.DOWNLOAD_NOT_ALLOWED, ex.getRejectionReason());
        assertTrue(ex.getReason().contains("disabled downloads"));
    }

    @Test
    @DisplayName("Track with missing download URL throws TrackEligibilityException with DOWNLOAD_URL_MISSING")
    void testMissingDownloadUrl() throws Exception {
        String json = """
            {
              "headers": { "status": "success", "code": 0 },
              "results": [
                {
                  "id": "121711",
                  "name": "Old Pal",
                  "artist_name": "Zack David",
                  "audiodownload": "",
                  "audiodownload_allowed": true,
                  "license_ccurl": "http://creativecommons.org/licenses/by-sa/3.0/"
                }
              ]
            }
            """;
        mockApiResponse(200, json);

        TrackEligibilityException ex = assertThrows(TrackEligibilityException.class,
                () -> client.requirePermittedTracks(List.of("121711")));
        assertEquals("121711", ex.getTrackId());
        assertEquals(TrackRejectionReason.DOWNLOAD_URL_MISSING, ex.getRejectionReason());
        assertTrue(ex.getReason().contains("does not provide an audio download URL"));
    }

    @Test
    @DisplayName("Missing track ID throws TrackEligibilityException with TRACK_NOT_RETURNED")
    void testMissingTrackId() throws Exception {
        String json = """
            {
              "headers": { "status": "success", "code": 0 },
              "results": []
            }
            """;
        mockApiResponse(200, json);

        TrackEligibilityException ex = assertThrows(TrackEligibilityException.class,
                () -> client.requirePermittedTracks(List.of("999999")));
        assertEquals("999999", ex.getTrackId());
        assertEquals(TrackRejectionReason.TRACK_NOT_RETURNED, ex.getRejectionReason());
        assertTrue(ex.getReason().contains("was not found on Jamendo"));
    }

    @Test
    @DisplayName("Unsupported license throws TrackEligibilityException with UNSUPPORTED_LICENSE and specifies the license")
    void testUnsupportedLicense() throws Exception {
        String json = """
            {
              "headers": { "status": "success", "code": 0 },
              "results": [
                {
                  "id": "121711",
                  "name": "Old Pal",
                  "artist_name": "Zack David",
                  "audiodownload": "https://storage.jamendo.com/download/track/121711/mp32/",
                  "audiodownload_allowed": true,
                  "license_ccurl": "http://creativecommons.org/licenses/by-nc-nd/3.0/"
                }
              ]
            }
            """;
        mockApiResponse(200, json);

        TrackEligibilityException ex = assertThrows(TrackEligibilityException.class,
                () -> client.requirePermittedTracks(List.of("121711")));
        assertEquals("121711", ex.getTrackId());
        assertEquals(TrackRejectionReason.UNSUPPORTED_LICENSE, ex.getRejectionReason());
        assertTrue(ex.getReason().contains("by-nc-nd/3.0"));
        assertTrue(ex.getReason().contains("Only CC BY and CC BY-SA licenses are supported"));
    }

    @Test
    @DisplayName("Multi-track batch query formats parameters with id[]= for reliable array handling")
    void testMultiTrackBatchQueryParameters() throws Exception {
        String json = """
            {
              "headers": { "status": "success", "code": 0 },
              "results": [
                {
                  "id": "101",
                  "name": "Song 101",
                  "artist_name": "Artist",
                  "audiodownload": "https://storage.jamendo.com/101.mp3",
                  "audiodownload_allowed": true,
                  "license_ccurl": "http://creativecommons.org/licenses/by/3.0/"
                },
                {
                  "id": "102",
                  "name": "Song 102",
                  "artist_name": "Artist",
                  "audiodownload": "https://storage.jamendo.com/102.mp3",
                  "audiodownload_allowed": true,
                  "license_ccurl": "http://creativecommons.org/licenses/by-sa/2.5/it/"
                }
              ]
            }
            """;
        mockApiResponse(200, json);

        List<JamendoTrack> tracks = client.requirePermittedTracks(List.of("101", "102"));
        assertEquals(2, tracks.size());

        ArgumentCaptor<HttpRequest> requestCaptor = ArgumentCaptor.forClass(HttpRequest.class);
        verify(mockHttpClient).send(requestCaptor.capture(), any());
        HttpRequest request = requestCaptor.getValue();
        String uri = request.uri().toString();

        assertTrue(uri.contains("id[]=101"));
        assertTrue(uri.contains("id[]=102"));
        assertTrue(uri.contains("type=single+albumtrack"));
        assertTrue(uri.contains("audioformat=mp32"));
        assertTrue(uri.contains("audiodlformat=mp32"));
    }

    @Test
    @DisplayName("Ported Creative Commons jurisdiction variants (e.g. Italian 2.5) are permitted during revalidation")
    void testPortedJurisdictionLicenseAllowed() throws Exception {
        String json = """
            {
              "headers": { "status": "success", "code": 0 },
              "results": [
                {
                  "id": "102",
                  "name": "Italian Song",
                  "artist_name": "Artista",
                  "audiodownload": "https://storage.jamendo.com/102.mp3",
                  "audiodownload_allowed": true,
                  "license_ccurl": "http://creativecommons.org/licenses/by-sa/2.5/it/"
                }
              ]
            }
            """;
        mockApiResponse(200, json);

        List<JamendoTrack> tracks = client.requirePermittedTracks(List.of("102"));
        assertEquals(1, tracks.size());
        assertEquals("http://creativecommons.org/licenses/by-sa/2.5/it/", tracks.get(0).licenseUrl());
    }

    @Test
    @DisplayName("fetchPermittedTrack returns empty Optional when track fails revalidation")
    void testFetchPermittedTrackFailsSilentlyIntoEmptyOptional() throws Exception {
        String json = """
            {
              "headers": { "status": "success", "code": 0 },
              "results": [
                {
                  "id": "121711",
                  "name": "Old Pal",
                  "artist_name": "Zack David",
                  "audiodownload": "https://storage.jamendo.com/download/track/121711/mp32/",
                  "audiodownload_allowed": false,
                  "license_ccurl": "http://creativecommons.org/licenses/by-sa/3.0/"
                }
              ]
            }
            """;
        mockApiResponse(200, json);

        Optional<JamendoTrack> track = client.fetchPermittedTrack("121711");
        assertTrue(track.isEmpty());
    }

    @Test
    @DisplayName("fetchPermittedTrack returns track when all eligibility conditions are met")
    void testFetchPermittedTrackSucceeds() throws Exception {
        String json = """
            {
              "headers": { "status": "success", "code": 0 },
              "results": [
                {
                  "id": "121711",
                  "name": "Old Pal",
                  "artist_name": "Zack David",
                  "album_name": "Winds of Change",
                  "audiodownload": "https://storage.jamendo.com/download/track/121711/mp32/",
                  "audiodownload_allowed": true,
                  "license_ccurl": "http://creativecommons.org/licenses/by-sa/3.0/"
                }
              ]
            }
            """;
        mockApiResponse(200, json);

        Optional<JamendoTrack> track = client.fetchPermittedTrack("121711");
        assertTrue(track.isPresent());
        assertEquals("Old Pal", track.get().title());
    }
}
