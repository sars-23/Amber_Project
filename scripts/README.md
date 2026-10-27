# Amber Operator & Evaluation Tools

Standalone command-line utilities for bulk audio catalogue ingestion and recognition-quality evaluation against an Amber instance.

---

## Overview

The tools in this directory enable operators to:
1. **Bulk Ingestion (`scripts/bulk-import.mjs`)**: Ingest directories of 50–100+ local audio tracks safely into Amber's reference library via the standard multipart upload API (`POST /api/v1/songs`).
2. **Recognition Evaluation (`scripts/recognition-evaluator.mjs`)**: Measure empirical song identification accuracy, false positive/negative rates, time-offset accuracy (MAE), and search latency distribution against `POST /api/v1/search`.

Both tools:
- Default to **Dry Run mode** (read-only verification). Real network writes or queries require an explicit `--execute` flag.
- Enforce strict path traversal prevention (audio files must resolve inside the specified base directory).
- Match the backend's format, duration, and file size constraints.
- Redact secrets (`AMBER_ADMIN_API_KEY`) from all terminal output, logs, and exported reports.

---

## 1. Bulk Catalogue Ingestion (`bulk-import.mjs`)

### 1.1 Preparing Audio Files & CSV Manifest

Place your audio files inside a dedicated folder (e.g., `./my-music/`). Create a CSV manifest referencing files via relative paths:

```csv
relative_path,title,artist,license,source_url
tracks/acoustic_breeze.wav,Acoustic Breeze,Benjamin Tissot,CC-BY-4.0,https://www.bensound.com
tracks/sunny_afternoon.mp3,Sunny Afternoon,Open Audio Collective,CC0-1.0,https://freemusicarchive.org/music/sunny
tracks/creative_minds.wav,Creative Minds,Benjamin Tissot,CC-BY-4.0,https://www.bensound.com
```

#### Required Manifest Columns:
- `relative_path`: Relative path from the `--audio-dir` root. Must resolve strictly inside `--audio-dir`.
- `title`: Track title (1 to 255 characters).
- `artist`: Track artist (1 to 255 characters).
- `license`: Music license identifier (e.g., `CC-BY-4.0`, `CC0-1.0`, `Public Domain`, or proprietary license ID).
- `source_url`: URL or source repository verifying track provenance and licensing rights.

#### Audio Format & Size Rules (matching Amber backend):
- **Supported Formats**: `.wav`, `.mp3`, `.flac`, `.ogg`, `.m4a`, `.aac`, `.opus`, `.wma`, `.aiff`.
- **File Size**: Minimum 12 bytes, maximum 25 MB (`26,214,400 bytes`).
- **Decoded Duration**: Between 1 second and 600 seconds (10 minutes).
- **RMS Energy**: Non-silent audio (RMS energy $\ge 10^{-5}$).

---

### 1.2 Step 1: Running a Dry Run

Running without `--execute` performs a complete dry run without uploading any audio:

```bash
node scripts/bulk-import.mjs \
  --audio-dir /path/to/music \
  --manifest scripts/manifests/catalogue-sample.csv
```

The dry run will:
1. Verify the manifest structure and column headers.
2. Check that every audio file exists, has a valid extension, and is within size limits.
3. Check for path traversal attempts (`../`).
4. Query the existing Amber catalogue via `GET /api/v1/songs` and flag any duplicate tracks.
5. Display a detailed summary table of what *would* be uploaded, skipped, or rejected.
6. Write a structured JSON preview to `./bulk-import-report.json`.

---

### 1.3 Step 2: Configuring Administrative Authentication

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

### 1.4 Step 3: Executing the Ingestion

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

### 1.5 Resuming an Interrupted Import

If an import is stopped midway (e.g. network interruption, container sleep, or manual cancellation), the tool saves its progress to the JSON report after every single track.

To resume without re-uploading already indexed tracks:

```bash
node scripts/bulk-import.mjs \
  --audio-dir /path/to/music \
  --manifest /path/to/manifest.csv \
  --report ./bulk-import-report.json \
  --resume \
  --execute
```

Tracks marked as `SUCCESS` or `SKIPPED` in the report will be skipped automatically.

---

## 2. Recognition-Quality Evaluation (`recognition-evaluator.mjs`)

The evaluator runs repeatable empirical accuracy tests by submitting query excerpts to `POST /api/v1/search` and evaluating the returned candidates against expected ground-truth metadata.

> [!NOTE]
> Reference tracks must already be indexed in the Amber catalogue before evaluating their excerpts.

---

### 2.1 Preparing an Evaluation Manifest

Create an evaluation CSV referencing audio excerpts:

```csv
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
