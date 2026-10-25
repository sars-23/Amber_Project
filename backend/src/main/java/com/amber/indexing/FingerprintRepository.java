package com.amber.indexing;

import com.amber.fingerprint.Fingerprint;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ParameterizedPreparedStatementSetter;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.*;

@Repository
public class FingerprintRepository {

    private static final Logger log = LoggerFactory.getLogger(FingerprintRepository.class);
    private static final int DEFAULT_BATCH_SIZE = 2000;
    private static final int QUERY_CHUNK_SIZE = 1000;

    private final JdbcTemplate jdbcTemplate;
    private final NamedParameterJdbcTemplate namedParameterJdbcTemplate;

    public FingerprintRepository(JdbcTemplate jdbcTemplate, NamedParameterJdbcTemplate namedParameterJdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
        this.namedParameterJdbcTemplate = namedParameterJdbcTemplate;
    }

    /**
     * Inserts a list of fingerprints for a given song in batched JDBC statements.
     */
    public int batchInsert(long songId, List<Fingerprint> fingerprints) {
        return batchInsert(songId, fingerprints, DEFAULT_BATCH_SIZE);
    }

    public int batchInsert(long songId, List<Fingerprint> fingerprints, int batchSize) {
        if (fingerprints == null || fingerprints.isEmpty()) {
            return 0;
        }

        String sql = "INSERT INTO fingerprints (hash, song_id, anchor_time_ms) VALUES (?, ?, ?)";

        long start = System.currentTimeMillis();
        int[][] updateCounts = jdbcTemplate.batchUpdate(
                sql,
                fingerprints,
                batchSize,
                (ParameterizedPreparedStatementSetter<Fingerprint>) (ps, fp) -> {
                    ps.setInt(1, fp.hash());
                    ps.setLong(2, songId);
                    ps.setInt(3, fp.anchorTimeMs());
                }
        );

        int totalInserted = 0;
        for (int[] counts : updateCounts) {
            totalInserted += counts.length;
        }

        long duration = System.currentTimeMillis() - start;
        log.debug("Batch inserted {} fingerprints for songId={} in {}ms", totalInserted, songId, duration);

        return totalInserted;
    }

    /**
     * Looks up candidate indexed fingerprints for a collection of query hashes.
     * Queries in chunks of up to 1,000 hashes to prevent statement size limits.
     */
    public List<IndexedFingerprint> findCandidatesByHashes(Collection<Integer> hashes) {
        if (hashes == null || hashes.isEmpty()) {
            return Collections.emptyList();
        }

        List<Integer> hashList = new ArrayList<>(hashes);
        List<IndexedFingerprint> candidates = new ArrayList<>();

        String sql = "SELECT hash, song_id, anchor_time_ms FROM fingerprints WHERE hash IN (:hashes)";

        for (int i = 0; i < hashList.size(); i += QUERY_CHUNK_SIZE) {
            List<Integer> chunk = hashList.subList(i, Math.min(hashList.size(), i + QUERY_CHUNK_SIZE));
            MapSqlParameterSource params = new MapSqlParameterSource("hashes", chunk);

            List<IndexedFingerprint> chunkResults = namedParameterJdbcTemplate.query(
                    sql,
                    params,
                    (rs, rowNum) -> new IndexedFingerprint(
                            rs.getInt("hash"),
                            rs.getLong("song_id"),
                            rs.getInt("anchor_time_ms")
                    )
            );
            candidates.addAll(chunkResults);
        }

        return candidates;
    }

    public long count() {
        String sql = "SELECT COUNT(*) FROM fingerprints";
        Long count = jdbcTemplate.queryForObject(sql, Long.class);
        return count != null ? count : 0L;
    }

    public void deleteBySongId(long songId) {
        String sql = "DELETE FROM fingerprints WHERE song_id = ?";
        jdbcTemplate.update(sql, songId);
    }
}
