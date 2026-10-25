-- EchoTrace Schema Migration V1
-- Creates songs and fingerprints tables with optimized B-tree indexes

CREATE TABLE IF NOT EXISTS songs (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    artist VARCHAR(255) NOT NULL,
    duration_ms BIGINT NOT NULL,
    fingerprint_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS fingerprints (
    hash INT NOT NULL,
    song_id BIGINT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    anchor_time_ms INT NOT NULL
);

-- Index for high-throughput candidate lookup by fingerprint hash
CREATE INDEX IF NOT EXISTS idx_fingerprints_hash ON fingerprints(hash);

-- Composite index for fast count and song-scoped lookups
CREATE INDEX IF NOT EXISTS idx_fingerprints_song_id ON fingerprints(song_id);

-- Combined index for fast candidate join
CREATE INDEX IF NOT EXISTS idx_fingerprints_hash_song_anchor ON fingerprints(hash, song_id, anchor_time_ms);
