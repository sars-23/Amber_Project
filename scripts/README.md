# Amber Operator & Evaluation Tools

Standalone command-line utilities for bulk audio catalogue ingestion and recognition-quality evaluation against an Amber instance.

---

## Overview

The tools in this directory enable operators to:
1. **Bulk Ingestion (`scripts/bulk-import.mjs`)**: Ingest directories of 50–100+ local audio tracks safely into Amber's reference library via the standard multipart upload API (`POST /api/v1/songs`).
2. **Recognition Evaluation (`scripts/recognition-evaluator.mjs`)**: Measure empirical song identification accuracy, false positive/negative rates, time-offset accuracy (MAE), and search latency distribution against `POST /api/v1/search`.

Both tools:
- Default to **Dry Run mode** (read-only verification). Real network writes or queries require an explicit `--execute` flag.
- Enforce strict path traversal prevention (audio files must resolve strictly inside the specified base directory).
- Match the backend's format, duration, and file size constraints.
- Redact secrets (`AMBER_ADMIN_API_KEY`) from all terminal output, logs, and exported reports.

---

## 1. Bulk Catalogue Ingestion (`bulk-import.mjs`)

### 1.1 Preparing Audio Files & CSV Manifest

Place your audio files inside a dedicated folder (e.g., `./my-music/`). Create a CSV manifest referencing files via relative paths:

```csv
# AMBER CATALOGUE INGESTION TEMPLATE — EXAMPLES ONLY
# WARNING: These placeholder entries are structural illustrations and NOT ready for ingestion.
# Replace with verified local audio paths, accurate metadata, approved licenses, and valid source URLs.
relative_path,title,artist,license,source_url
tracks/acoustic_breeze.wav,Acoustic Breeze,Benjamin Tissot,CC-BY-4.0,https://www.bensound.com/free-music-for-videos
tracks/sunny_afternoon.mp3,Sunny Afternoon,Open Audio Collective,CC0-1.0,https://freemusicarchive.org/music/sunny
```

> [!CAUTION]
> The sample manifest `scripts/manifests/catalogue-sample.csv` is an illustrative template only. Its entries are non-functional placeholders. Never infer that a track is licensed merely because it can be downloaded. Operators must verify license grants and supply valid audio files before ingestion.

#### Required Manifest Columns:
- `relative_path`: Relative path from the `--audio-dir` root. Must resolve strictly inside `--audio-dir`.
- `title`: Track title (1 to 255 characters).
- `artist`: Track artist (1 to 255 characters).
- `license`: Music license identifier (e.g., `CC-BY-4.0`, `CC0-1.0`, `Public Domain`, or proprietary license ID). Cannot be empty.
- `source_url`: Valid HTTP or HTTPS URL verifying track provenance and licensing rights. Malformed or non-HTTP/HTTPS URLs are rejected during preflight.

---

### 1.2 Truthful Preflight Audio Validation

The bulk importer inspects audio files before upload to match backend validation rules (`AudioValidationService.java` and `AudioProperties.java`):

1. **Path Traversal Protection**: Ensures the target file does not escape `--audio-dir`.
2. **File Size Bounds**: Rejects files under 12 bytes (`MIN_FILE_SIZE_BYTES`) or exceeding 25 MB / `26,214,400 bytes` (`MAX_FILE_SIZE_BYTES`).
3. **Supported Extensions**: `.wav`, `.mp3`, `.flac`, `.ogg`, `.m4a`, `.aac`, `.opus`, `.wma`, `.aiff` (aligned with backend FFmpeg & Java Sound decoders).
4. **Duration Bounds**: Decoded duration must be between **1.0 second** and **600.0 seconds** (10 minutes). Tracks outside these bounds are rejected during preflight.
5. **Silence Detection**: Audio with RMS energy $< 10^{-5}$ is rejected as silent:
   $$\text{RMS} = \sqrt{\frac{1}{N} \sum_{i=1}^{N} \left(\frac{s_i}{32768}\right)^2}$$
6. **Inspection Engine & Limitation Reporting**:
   - **Native Uncompressed PCM WAV**: Evaluated directly via pure-Node.js RIFF header and sample decoding (calculating duration and exact sample RMS).
   - **Compressed Formats (MP3, FLAC, OGG, etc.)**: Evaluated via local `ffprobe`/`ffmpeg` executable (from `AMBER_FFPROBE_PATH`, `AMBER_FFMPEG_PATH`, system PATH, or Stremio installation).
   - **Tool Limitation Disclosure**: If FFmpeg/ffprobe is unavailable in the execution environment and the file is in a compressed container, the validator marks the track with `validationLevel: 'structural_only'` and reports that full media decoding, duration, and silence checks were skipped, rather than falsely claiming full verification.

---

### 1.3 Fail-Closed Duplicate Safety

Before initiating imports, the tool queries the Amber catalogue via `GET /api/v1/songs` with pagination:

- **Execute Mode (`--execute`)**: If catalogue retrieval fails or pagination is incomplete (e.g. HTTP 5xx, network timeout, database outage), the tool **fails closed immediately**:
  - Halts execution with exit code `1`.
  - Sends **zero** upload requests.
  - Explains that duplicate protection could not be verified against the remote catalogue.
- **Dry Run Mode**: If catalogue retrieval fails, items are marked with status `UNKNOWN` (duplicate status `UNKNOWN`) and a warning is printed. The tool never implies duplicates were checked successfully when catalogue retrieval fails.
- **In-Manifest Duplicate Detection**: Identifies duplicate tracks within the same CSV batch regardless of backend availability.

---

### 1.4 Step 1: Running a Dry Run

Running without `--execute` performs a complete dry run without uploading any audio:

```bash
node scripts/bulk-import.mjs \
  --audio-dir /path/to/music \
  --manifest scripts/manifests/catalogue-sample.csv
```

The dry run will:
1. Verify manifest structure, column headers, non-empty licenses, and valid HTTP/HTTPS source URLs.
2. Check that every audio file exists, has an allowed extension, and is within size limits.
3. Check for path traversal attempts (`../`).
4. Inspect duration and RMS silence (or report tool limitations).
5. Query existing Amber catalogue and flag duplicates or report `UNKNOWN` state if catalogue is unavailable.
6. Write a structured JSON preview to `./bulk-import-report.json`.

---

### 1.5 Step 2: Configuring Administrative Authentication

When uploading to the catalogue (`POST /api/v1/songs`), Amber requires administrative authorization. Set the administrative key in your shell:

#### On Linux / macOS / Git Bash:
```bash
export AMBER_ADMIN_API_KEY="your-secret-admin-key"
```

#### On Windows PowerShell:
```powershell
$env:AMBER_ADMIN_API_KEY = "your-secret-admin-key"
```

> [!IMPORTANT]
> The admin API key is read strictly from the `AMBER_ADMIN_API_KEY` environment variable. Never commit this key to Git or hardcode it in manifests.

---

### 1.6 Step 3: Executing the Ingestion

To execute the import against a local or remote Amber instance:

```bash
node scripts/bulk-import.mjs \
  --audio-dir /path/to/music \
  --manifest /path/to/manifest.csv \
  --api-url http://localhost:8080/api/v1 \
  --execute
```

#### CLI Options:
| Flag | Description | Default |
|---|---|---|
| `-d, --audio-dir <path>` | Root directory containing audio files | *(Required)* |
| `-m, --manifest <path>` | Path to CSV manifest file | *(Required)* |
| `-u, --api-url <url>` | Amber REST API base URL | `http://localhost:8080/api/v1` |
| `--execute` | Perform actual ingestion. Default is safe Dry Run mode | `false` |
| `-r, --report <path>` | Path to output JSON progress report | `./bulk-import-report.json` |
| `--resume` | Resume an interrupted run, skipping already completed tracks | `false` |
| `--allow-duplicates` | Ingest tracks even if title/artist exists in catalogue | `false` |
| `--timeout <ms>` | HTTP request timeout in milliseconds | `30000` |
| `--max-retries <n>` | Retry attempts for transient server errors (5xx/network) | `3` |

---

### 1.7 Resuming an Interrupted Import & Idempotency Notes

If an import is stopped midway (e.g. network interruption, manual cancellation, or server timeout), the tool saves its progress to the JSON report after every single track.

To resume without re-uploading already indexed tracks:

```bash
node scripts/bulk-import.mjs \
  --audio-dir /path/to/music \
  --manifest /path/to/manifest.csv \
  --report ./bulk-import-report.json \
  --resume \
  --execute
```

- Tracks recorded as `SUCCESS` or `SKIPPED` in the prior report are matched by relative path and normalized track metadata, and are **preserved without re-uploading**.
- **Upload Timeout Limitation**: If a network timeout occurs while waiting for `POST /api/v1/songs` response, the server may have processed and indexed the track even though the client received no confirmation. Because the Amber REST API does not provide an idempotency key header (`Idempotency-Key`), the tool does not claim exactly-once delivery guarantees. Resuming re-checks the remote catalogue to safely verify whether the timed-out track was committed.

---

## 2. Recognition-Quality Evaluation (`recognition-evaluator.mjs`)

The evaluator runs repeatable empirical accuracy tests by submitting query excerpts to `POST /api/v1/search` and evaluating the returned candidates against expected ground-truth metadata.

> [!NOTE]
> Reference tracks must already be indexed in the Amber catalogue before evaluating their excerpts. In dry-run mode, zero search queries are dispatched to the server.

---

### 2.1 Preparing an Evaluation Manifest

Create an evaluation CSV referencing audio excerpts:

```csv
# AMBER RECOGNITION EVALUATION TEMPLATE — EXAMPLES ONLY
# WARNING: Placeholder evaluation fixtures for demonstration. Reference tracks must be pre-indexed in Amber.
query_path,expected_title,expected_artist,expected_offset_ms,label
excerpts/acoustic_breeze_crop3s.wav,Acoustic Breeze,Benjamin Tissot,3000,clean-crop-3s
excerpts/acoustic_breeze_snr6db.wav,Acoustic Breeze,Benjamin Tissot,3000,snr-6db
excerpts/ambient_white_noise.wav,,,,negative-control
```

#### Columns:
- `query_path`: Path to excerpt audio file relative to `--audio-dir`.
- `expected_title`: Title of the indexed track expected to match. Leave empty for negative controls.
- `expected_artist`: Artist of the indexed track expected to match.
- `expected_offset_ms`: Ground-truth timestamp (ms) where this excerpt starts in the original master recording.
- `label`: Test condition tag (e.g., `clean-crop`, `snr-20db`, `snr-6db`, `same-recording`, `negative-control`).

---

### 2.2 Running Evaluation

#### Dry Run (Fixture Validation):
```bash
node scripts/recognition-evaluator.mjs \
  --audio-dir /path/to/excerpts \
  --manifest scripts/manifests/evaluation-sample.csv
```

#### Execution:
```bash
node scripts/recognition-evaluator.mjs \
  --audio-dir /path/to/excerpts \
  --manifest scripts/manifests/evaluation-sample.csv \
  --api-url http://localhost:8080/api/v1 \
  --report-json ./evaluation-report.json \
  --report-csv ./evaluation-report.csv \
  --execute
```

#### CLI Options:
| Flag | Description | Default |
|---|---|---|
| `-d, --audio-dir <path>` | Root directory containing query audio excerpts | *(Required)* |
| `-m, --manifest <path>` | Path to evaluation CSV manifest | *(Required)* |
| `-u, --api-url <url>` | Amber REST API base URL | `http://localhost:8080/api/v1` |
| `--execute` | Perform actual search queries against the API | `false` |
| `--report-json <path>` | Path to save JSON metrics report | `./evaluation-report.json` |
| `--report-csv <path>` | Optional path to export per-query CSV results | `none` |
| `--concurrency <n>` | Max parallel query workers (bounded 1–4) | `1` |
| `--offset-tolerance-ms <n>` | Allowable offset error tolerance in ms | `250` |

---

### 2.3 Understanding Evaluation Metrics

The evaluator distinguishes between **song identification accuracy** and **time-offset alignment**:

1. **Identification Accuracy (Match Rate %)**:
   $$\text{Match Rate} = \frac{\text{Correct Matches}}{\text{Expected Matches}} \times 100$$
   A query is marked as a **Correct Match** only if the server returns `matched: true` AND the matched track matches the expected title and artist.
2. **False Negatives (Missed Matches)**:
   The query corresponds to an indexed song, but the search engine returned `matched: false`. Common under extreme acoustic degradation or low SNR.
3. **False Positives (Wrong Song Matches)**:
   The engine matched a song, but it was the *wrong* track (or matched an un-indexed negative control excerpt).
4. **Offset Mean Absolute Error (MAE in ms)**:
   $$\text{Offset MAE} = \frac{1}{M} \sum_{i=1}^{M} |\text{estimatedOffsetMs}_i - \text{expectedOffsetMs}_i|$$
   Evaluated strictly across correct matches. Amber's frame resolution at 11,025 Hz with a 512-sample hop size is $\approx 46.4\text{ ms}$, meaning an offset error $\le 100\text{ ms}$ indicates near-exact frame alignment.
5. **Latency Distribution (p50 / p95 in ms)**:
   Median (50th percentile) and 95th percentile query processing latencies, measuring end-to-end HTTP response times.

---

## 3. Music Licensing & Dataset Governance

When assembling audio datasets for evaluation or production catalogue expansion:
1. **Authorized Sources**:
   - Use only tracks under permissive licenses (e.g. Creative Commons CC0, CC-BY, CC-BY-SA) or royalty-free tracks where you have written permission or rights to ingest.
   - Example reputable platforms: [Free Music Archive](https://freemusicarchive.org/), [Bensound](https://www.bensound.com/), [Internet Archive Audio](https://archive.org/details/audio).
2. **Attribution & Provenance**:
   - Always record the license identifier and source URL in the CSV manifest.
   - Keep licensing records alongside local audio files.
3. **Redistribution Restrictions**:
   - Do not commit copyrighted audio files, commercial recordings, or private audio datasets to the public Git repository.
   - The repository's `.gitignore` automatically excludes `scripts/data/`, `audio-data/`, and generated report files.

---

## 4. Running Automated Tool Tests

The tools include a zero-dependency test suite running on Node.js's native test runner (`node --test`). Tests use mocked HTTP responses and synthetic fixtures, guaranteeing zero network calls and zero credential requirements:

```bash
# Run all script tests
node --test scripts/test/*.test.mjs
```
