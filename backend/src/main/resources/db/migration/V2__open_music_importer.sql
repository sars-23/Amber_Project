-- Open Music Importer: durable jobs and per-track provenance.
-- Audio files are temporary; only source/license metadata and fingerprints are retained.
ALTER TABLE songs ADD COLUMN IF NOT EXISTS source_provider VARCHAR(32);
ALTER TABLE songs ADD COLUMN IF NOT EXISTS source_track_id VARCHAR(128);
ALTER TABLE songs ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS license_url TEXT;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS attribution_text TEXT;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS content_sha256 CHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_songs_source_track
    ON songs(source_provider, source_track_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_songs_content_sha256
    ON songs(content_sha256);

CREATE TABLE IF NOT EXISTS open_music_import_jobs (
    id UUID PRIMARY KEY,
    status VARCHAR(32) NOT NULL,
    requested_count INTEGER NOT NULL CHECK (requested_count BETWEEN 1 AND 25),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS open_music_import_items (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES open_music_import_jobs(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL,
    external_track_id VARCHAR(128) NOT NULL,
    title VARCHAR(255) NOT NULL,
    artist VARCHAR(255) NOT NULL,
    album_name VARCHAR(255),
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
    download_url TEXT,
    source_url TEXT NOT NULL,
    license_url TEXT NOT NULL,
    attribution_text TEXT NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    error_message VARCHAR(600),
    downloaded_bytes BIGINT,
    content_sha256 CHAR(64),
    song_id BIGINT REFERENCES songs(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (job_id, provider, external_track_id)
);

CREATE INDEX IF NOT EXISTS idx_open_music_items_queue
    ON open_music_import_items(status, created_at);
CREATE INDEX IF NOT EXISTS idx_open_music_items_job
    ON open_music_import_items(job_id, created_at);
