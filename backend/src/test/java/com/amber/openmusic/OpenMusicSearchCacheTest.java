package com.amber.openmusic;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class OpenMusicSearchCacheTest {

    private JamendoClient mockJamendoClient;
    private OpenMusicImportRepository mockRepository;
    private OpenMusicImportService service;

    @BeforeEach
    void setUp() {
        mockJamendoClient = Mockito.mock(JamendoClient.class);
        mockRepository = Mockito.mock(OpenMusicImportRepository.class);
        service = new OpenMusicImportService(mockJamendoClient, mockRepository);
    }

    @Test
    @DisplayName("Identical searches return cached results without re-querying Jamendo")
    void testSearchCacheHit() {
        JamendoTrack track = new JamendoTrack("501", "Ambient Light", "Artist", "Album", 120,
                "https://storage.jamendo.com/501.mp3", "https://jamendo.com/track/501",
                "https://creativecommons.org/licenses/by/4.0/", "Attribution");

        when(mockJamendoClient.search(eq("ambient"), anyInt())).thenReturn(List.of(track));

        // First call hits Jamendo client
        List<JamendoTrackView> result1 = service.search("ambient", 10);
        assertEquals(1, result1.size());
        assertEquals("501", result1.get(0).id());
        verify(mockJamendoClient, times(1)).search(eq("ambient"), eq(10));

        // Second call with same query and limit hits cache
        List<JamendoTrackView> result2 = service.search("ambient", 10);
        assertEquals(1, result2.size());
        assertEquals("501", result2.get(0).id());
        // Verify Jamendo was NOT called again!
        verify(mockJamendoClient, times(1)).search(eq("ambient"), eq(10));

        // Third call with whitespace / casing difference is normalized and also hits cache
        List<JamendoTrackView> result3 = service.search("  AMBIENT  ", 10);
        assertEquals(1, result3.size());
        verify(mockJamendoClient, times(1)).search(anyString(), anyInt());
    }

    @Test
    @DisplayName("Different search queries execute separate Jamendo requests")
    void testDifferentQueriesNotShared() {
        when(mockJamendoClient.search(eq("jazz"), anyInt())).thenReturn(List.of());
        when(mockJamendoClient.search(eq("rock"), anyInt())).thenReturn(List.of());

        service.search("jazz", 10);
        service.search("rock", 10);

        verify(mockJamendoClient, times(1)).search(eq("jazz"), eq(10));
        verify(mockJamendoClient, times(1)).search(eq("rock"), eq(10));
    }

    @Test
    @DisplayName("Clearing search cache causes subsequent search to query Jamendo again")
    void testClearCache() {
        when(mockJamendoClient.search(eq("chill"), anyInt())).thenReturn(List.of());

        service.search("chill", 10);
        verify(mockJamendoClient, times(1)).search(eq("chill"), eq(10));

        service.clearSearchCache();

        service.search("chill", 10);
        verify(mockJamendoClient, times(2)).search(eq("chill"), eq(10));
    }
}
