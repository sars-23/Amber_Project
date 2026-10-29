# Amber Open Music Importer

The Open Music Importer adds a Jamendo search and batch-indexing experience to Amber (`Library → Open Music`). It connects directly to Amber's existing `SongIndexingService` and PostgreSQL fingerprint tables, retaining provenance metadata while deleting audio files immediately after processing.

## 1. Overview & Architecture

- **Public Search & Abuse Controls**: Query Jamendo's official track catalog via `/api/v1/open-music/search` without credentials. Search requests are protected by a bounded per-IP rate limiter (30 requests/minute with `429 Too Many Requests` and `Retry-After`) and a short-lived in-memory LRU cache (3-minute TTL, 500 entries) to prevent API exhaustion.
- **Administrative Authorization**: Queue creation, status querying, retries, and cancellations are protected by `AMBER_ADMIN_API_KEY` (via `X-Amber-Admin-Key` or `Authorization: Bearer <key>`).
- **No Persisted Download URLs**: The import queue schema never persists temporary or signed download URLs. It stores only the external provider (`jamendo`) and track ID. Fresh URLs are fetched from Jamendo immediately before downloading.
- **Durable Queue in PostgreSQL**: Import batches (up to 25 tracks) are persisted in `open_music_import_jobs` and `open_music_import_items`.
- **Multi-Instance Concurrency & Safe Recovery**: Workers claim items using transactional row locking (`FOR UPDATE`) with explicit worker identification (`locked_by`) and lease expiration (`lease_until`). Healthy active items held by concurrent backend instances are never reclaimed. Abandoned items (whose lease expired) are recovered automatically without risk of double-processing.
- **Strict HTTPS & Port Validation**: Audio downloads strictly require HTTPS on default port 443 (`port == -1 || port == 443`), reject embedded credentials (`userInfo`), and reject unapproved redirect destinations. Downloads are restricted to approved Jamendo storage endpoints (`storage.jamendo.com`, `*.storage.jamendo.com`, `usercontent.jamendo.com`, `*.usercontent.jamendo.com`, `mp3d.jamendo.com`, `*.mp3d.jamendo.com`, `api.jamendo.com`) with up to 4 re-validated redirects.
- **Stream Limit Enforcement**: Max 25 MB per audio file, enforced while streaming even if `Content-Length` is missing.
- **Guaranteed Cleanup**: Temporary audio files are removed in a `finally` block on both success and failure.
- **Deduplication**: Checked by `(source_provider, source_track_id)` and SHA-256 audio content hash before and after indexing.

## 2. Configuration

### Backend Environment Variables
- `JAMENDO_CLIENT_ID`: Required for Jamendo API access. Obtained from the [Jamendo Developer Portal](https://developer.jamendo.com/). Configured strictly on the backend service; never exposed in frontend bundles or API views.
- `AMBER_ADMIN_API_KEY`: Required for queue write operations and catalog management.
- `AMBER_OPEN_MUSIC_WORKER_DELAY_MS`: Optional. Delay between processing queued tracks (defaults to `3000` ms).

### Render Deployment
In Render dashboard:
1. Open **amber-backend** → **Environment**.
2. Add `JAMENDO_CLIENT_ID` with your Jamendo client ID.
3. Ensure `AMBER_ADMIN_API_KEY` is set.
4. Deploy backend to execute Flyway migrations (`V2__open_music_importer.sql` and `V3__open_music_hardening.sql`).
5. Deploy frontend.

## 3. Usage Flow

1. Navigate to **Library → Open Music**.
2. Search for tracks by genre, artist, or title (e.g., "ambient", "jazz", "electronic").
3. Inspect track duration, license, and Jamendo source links.
4. Select up to 25 tracks for ingestion.
5. Enter the Amber Admin API Key (held in memory only; never persisted to localStorage).
6. Click **Queue selected tracks**.
7. Monitor real-time progress. If any tracks fail, use **Retry failed**; to cancel remaining tracks, click **Cancel pending**.

## 4. Legal & Licensing Notice (Operational Gate)

> [!IMPORTANT]
> **Operational Status**: Bulk catalogue importing must remain disabled operationally in production environments until explicit written permission for Amber's intended acoustic recognition use case has been verified with Jamendo.

### Licensing Criteria vs. Platform Terms
Amber implements an automated technical gate requiring:
1. `audiodownload_allowed=true` on the Jamendo track metadata.
2. A Creative Commons license of **CC BY** (Attribution) or **CC BY-SA** (Attribution-ShareAlike).

While these Creative Commons licenses permit redistribution and adaptation of the underlying musical composition and recording with appropriate attribution, **these technical criteria do not independently establish that every intended use of the derived fingerprint catalogue is permitted under Jamendo's platform terms**.

### Official Terms of Use
- Jamendo Developer Platform: [https://developer.jamendo.com/](https://developer.jamendo.com/)
- Jamendo API Terms of Use: [https://developer.jamendo.com/v3.0/legal/terms-of-use](https://developer.jamendo.com/v3.0/legal/terms-of-use)

Jamendo's API Terms impose restrictions regarding data harvesting, automated mass querying, caching, and derivative database creation. Therefore:
- The presence of automated license filters in Amber code is an architectural control, **not a legal clearance or formal license approval**.
- Operators of Amber should not enable automated bulk ingest pipelines without reviewing Jamendo's API Terms of Use and obtaining appropriate platform authorization.
