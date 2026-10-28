-- Amber Migration V3: Open Music Importer Pre-Merge Hardening
-- 1. Remove download_url: Never persist temporary or signed audio download URLs.
ALTER TABLE open_music_import_items DROP COLUMN IF EXISTS download_url;

-- 2. Concurrency & restart recovery: Add explicit lease timestamp and worker instance identifier.
ALTER TABLE open_music_import_items ADD COLUMN IF NOT EXISTS lease_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE open_music_import_items ADD COLUMN IF NOT EXISTS locked_by VARCHAR(64);

-- 3. Composite index for high-throughput queue polling and expired lease recovery.
CREATE INDEX IF NOT EXISTS idx_open_music_items_lease
    ON open_music_import_items(status, lease_until);
