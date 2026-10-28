# Amber Open Music Importer

The Open Music Importer adds a Jamendo search and batch-indexing experience to Amber (`Library → Open Music`). It connects directly to Amber's existing `SongIndexingService` and PostgreSQL fingerprint tables, retaining provenance metadata while deleting audio files immediately after processing.

## 1. Overview & Architecture

- **Public Search**: Query Jamendo's official track catalog via `/api/v1/open-music/search` without credentials.
- **Conservative License Policy**: Only tracks with explicit `audiodownload_allowed=true` and Creative Commons **CC BY** or **CC BY-SA** licenses qualify for import.
- **Administrative Authorization**: Queue creation, status querying, retries, and cancellations are protected by `AMBER_ADMIN_API_KEY` (via `X-Amber-Admin-Key` or `Authorization: Bearer <key>`).
- **Durable Queue in PostgreSQL**: Import batches (up to 25 tracks) are persisted in `open_music_import_jobs` and `open_music_import_items`.
- **Fresh URL & Download Security**: Rather than relying on potentially expiring download URLs stored at queue time, the worker re-fetches fresh metadata and download URLs from Jamendo immediately before processing each track.
- **Strict HTTPS Host Validation**: Audio downloads are restricted to approved Jamendo storage endpoints (`storage.jamendo.com`, `*.storage.jamendo.com`, `usercontent.jamendo.com`, `*.usercontent.jamendo.com`, `mp3d.jamendo.com`, `*.mp3d.jamendo.com`, `api.jamendo.com`) with up to 4 re-validated redirects.
- **Stream Limit Enforcement**: Max 25 MB per audio file, enforced while streaming even if `Content-Length` is missing.
- **Guaranteed Cleanup**: Temporary audio files are removed in a `finally` block on both success and failure.
- **Deduplication**: Checked by `(source_provider, source_track_id)` and SHA-256 audio content hash before and after indexing.
- **Restart Recovery**: Interrupted `PROCESSING` items automatically recover to `PENDING` upon backend startup.

## 2. Configuration

### Backend Environment Variables
- `JAMENDO_CLIENT_ID`: Required. Client ID from the [Jamendo Developer Portal](https://developer.jamendo.com/). Set this only on the backend service. Never expose it in `VITE_` frontend variables.
- `AMBER_ADMIN_API_KEY`: Required for queue write operations and catalog management.
- `AMBER_OPEN_MUSIC_WORKER_DELAY_MS`: Optional. Delay between processing queued tracks (defaults to `3000` ms).

### Render Deployment
In Render dashboard:
1. Open **amber-backend** → **Environment**.
2. Add `JAMENDO_CLIENT_ID` with your Jamendo client ID.
3. Ensure `AMBER_ADMIN_API_KEY` is set.
4. Deploy backend to execute Flyway migration `V2__open_music_importer.sql`.
5. Deploy frontend.

## 3. Usage Flow

1. Navigate to **Library → Open Music**.
2. Search for tracks by genre, artist, or title (e.g., "ambient", "jazz", "electronic").
3. Inspect track duration, license, and Jamendo source links.
4. Select up to 25 tracks for ingestion.
5. Enter the Amber Admin API Key (held in memory only; never persisted to localStorage).
6. Click **Queue selected tracks**.
7. Monitor real-time progress. If any tracks fail, use **Retry failed**; to cancel remaining tracks, click **Cancel pending**.
