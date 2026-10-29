package com.amber.openmusic;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

@Service
public class OpenMusicImportService {
    private static final int MAX_BATCH_SIZE = 25;
    private static final int MAX_CACHE_ENTRIES = 500;
    private static final Duration CACHE_TTL = Duration.ofMinutes(3);

    private final JamendoClient jamendoClient;
    private final OpenMusicImportRepository repository;

    private record CacheEntry(List<JamendoTrackView> results, Instant expiresAt) {}

    private final Map<String, CacheEntry> searchCache = new LinkedHashMap<>(64, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, CacheEntry> eldest) {
            return size() > MAX_CACHE_ENTRIES;
        }
    };

    public OpenMusicImportService(JamendoClient jamendoClient, OpenMusicImportRepository repository) {
        this.jamendoClient = jamendoClient;
        this.repository = repository;
    }

    public List<JamendoTrackView> search(String query, int limit) {
        int clampedLimit = Math.max(1, Math.min(limit, 25));
        String normalizedQuery = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        String cacheKey = normalizedQuery + ":" + clampedLimit;

        synchronized (searchCache) {
            CacheEntry entry = searchCache.get(cacheKey);
            if (entry != null && Instant.now().isBefore(entry.expiresAt())) {
                return entry.results();
            }
        }

        List<JamendoTrackView> fresh = jamendoClient.search(query, clampedLimit)
                .stream().map(JamendoTrackView::from).toList();

        synchronized (searchCache) {
            searchCache.put(cacheKey, new CacheEntry(fresh, Instant.now().plus(CACHE_TTL)));
        }
        return fresh;
    }

    public void clearSearchCache() {
        synchronized (searchCache) {
            searchCache.clear();
        }
    }

    public UUID createJob(List<String> requestedIds) {
        if (requestedIds == null || requestedIds.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select at least one track.");
        }
        LinkedHashSet<String> ids = new LinkedHashSet<>(requestedIds);
        if (ids.size() > MAX_BATCH_SIZE) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A batch can contain at most 25 tracks.");
        }
        // Re-fetch all metadata on the server; never trust license or download URLs supplied by the browser.
        List<JamendoTrack> verifiedTracks = jamendoClient.requirePermittedTracks(new ArrayList<>(ids));
        return repository.createJob(verifiedTracks);
    }

    public List<OpenMusicImportJobView> getActiveJobs() {
        return repository.findActiveJobs();
    }

    public OpenMusicImportJobView getJob(UUID id) {
        repository.refreshJobStatus(id);
        return repository.findJob(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Import job not found."));
    }

    public OpenMusicImportJobView retryFailed(UUID id) {
        OpenMusicImportJobView existing = repository.findJob(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Import job not found."));
        if (existing.failed() == 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This job has no failed tracks to retry.");
        }
        repository.retryFailed(id);
        return getJob(id);
    }

    public OpenMusicImportJobView cancel(UUID id) {
        if (!repository.requestCancel(id)) {
            OpenMusicImportJobView current = repository.findJob(id).orElseThrow(() ->
                    new ResponseStatusException(HttpStatus.NOT_FOUND, "Import job not found."));
            if (List.of("COMPLETED", "COMPLETED_WITH_ERRORS", "CANCELLED").contains(current.status())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "This import job is already finished.");
            }
        }
        return getJob(id);
    }
}
