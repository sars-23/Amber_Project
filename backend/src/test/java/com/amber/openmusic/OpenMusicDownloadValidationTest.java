package com.amber.openmusic;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.io.IOException;
import java.net.URI;

import static org.junit.jupiter.api.Assertions.*;

class OpenMusicDownloadValidationTest {

    @Test
    @DisplayName("Valid Jamendo HTTPS URLs on default secure port pass validation")
    void testValidJamendoUrls() {
        assertDoesNotThrow(() ->
                OpenMusicImportWorker.validateDownloadUri(URI.create("https://storage.jamendo.com/download/track/12345.mp3")));
        assertDoesNotThrow(() ->
                OpenMusicImportWorker.validateDownloadUri(URI.create("https://mp3d.jamendo.com:443/download/track/12345.mp3")));
        assertDoesNotThrow(() ->
                OpenMusicImportWorker.validateDownloadUri(URI.create("https://usercontent.jamendo.com/stream/track/12345")));
        assertDoesNotThrow(() ->
                OpenMusicImportWorker.validateDownloadUri(URI.create("https://subdomain.storage.jamendo.com/audio.mp3")));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "http://storage.jamendo.com/track/123.mp3",
            "ftp://storage.jamendo.com/track/123.mp3",
            "file:///etc/passwd"
    })
    @DisplayName("Non-HTTPS schemes are rejected")
    void testNonHttpsRejected(String url) {
        IOException ex = assertThrows(IOException.class, () ->
                OpenMusicImportWorker.validateDownloadUri(URI.create(url)));
        assertTrue(ex.getMessage().contains("HTTPS"));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "https://storage.jamendo.com:8080/track/123.mp3",
            "https://storage.jamendo.com:8443/track/123.mp3",
            "https://storage.jamendo.com:80/track/123.mp3",
            "https://storage.jamendo.com:444/track/123.mp3"
    })
    @DisplayName("Non-standard HTTPS ports are rejected")
    void testNonStandardPortsRejected(String url) {
        IOException ex = assertThrows(IOException.class, () ->
                OpenMusicImportWorker.validateDownloadUri(URI.create(url)));
        assertTrue(ex.getMessage().contains("default HTTPS port (443)"));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "https://user:pass@storage.jamendo.com/track/123.mp3",
            "https://admin@mp3d.jamendo.com/track/123.mp3",
            "https://token:@storage.jamendo.com/track/123.mp3"
    })
    @DisplayName("Embedded credentials in download URLs are rejected")
    void testEmbeddedCredentialsRejected(String url) {
        IOException ex = assertThrows(IOException.class, () ->
                OpenMusicImportWorker.validateDownloadUri(URI.create(url)));
        assertTrue(ex.getMessage().contains("embedded credentials"));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "https://attacker.com/track/123.mp3",
            "https://storage.jamendo.com.attacker.com/track/123.mp3",
            "https://notjamendo.com/track/123.mp3",
            "https://localhost/audio.mp3",
            "https://169.254.169.254/metadata"
    })
    @DisplayName("Hosts outside approved Jamendo domains are rejected")
    void testUnapprovedHostsRejected(String url) {
        IOException ex = assertThrows(IOException.class, () ->
                OpenMusicImportWorker.validateDownloadUri(URI.create(url)));
        assertTrue(ex.getMessage().contains("outside approved Jamendo"));
    }

    @Test
    @DisplayName("Null URI is rejected")
    void testNullUriRejected() {
        assertThrows(IOException.class, () -> OpenMusicImportWorker.validateDownloadUri(null));
    }
}
