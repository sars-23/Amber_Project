#!/usr/bin/env node

/**
 * Amber Bulk Ingestion Tool
 *
 * Imports a local directory of audio files into an Amber instance through
 * the existing REST upload API (POST /api/v1/songs).
 *
 * Defaults to safe Dry Run mode unless --execute is explicitly passed.
 * Fails closed if catalogue duplicate check cannot be verified.
 * Halts on ambiguous upload outcomes to prevent duplicate ingestion.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseCsv } from './lib/csv-parser.mjs';
import {
  validateAudioPath,
  validateMetadata,
  validateLicensing,
  normalizeTrackKey
} from './lib/audio-validator.mjs';
import { AmberClient, AmbiguousUploadError } from './lib/amber-client.mjs';

const REQUIRED_COLUMNS = ['relative_path', 'title', 'artist', 'license', 'source_url'];

export async function runBulkImport(cliArgs = process.argv.slice(2), testOverrides = {}) {
  const options = {
    'audio-dir': { type: 'string', short: 'd' },
    'manifest': { type: 'string', short: 'm' },
    'api-url': { type: 'string', short: 'u', default: 'http://localhost:8080/api/v1' },
    'execute': { type: 'boolean', default: false },
    'report': { type: 'string', short: 'r', default: './bulk-import-report.json' },
    'resume': { type: 'boolean', default: false },
    'allow-duplicates': { type: 'boolean', default: false },
    'timeout': { type: 'string', default: '30000' },
    'max-retries': { type: 'string', default: '3' },
    'help': { type: 'boolean', short: 'h', default: false }
  };

  let parsed;
  try {
    parsed = parseArgs({ args: cliArgs, options, allowPositionals: false });
  } catch (err) {
    console.error(`Argument error: ${err.message}`);
    console.error('Run with --help to see available options.');
    return { exitCode: 1 };
  }

  const values = parsed.values;

  if (values.help) {
    printHelp();
    return { exitCode: 0 };
  }

  const audioDir = values['audio-dir'];
  const manifestPath = values['manifest'];
  const apiUrl = values['api-url'];
  const isExecute = Boolean(values.execute);
  const reportPath = values.report;
  const isResume = Boolean(values.resume);
  const allowDuplicates = Boolean(values['allow-duplicates']);
  const timeoutMs = parseInt(values.timeout, 10) || 30_000;
  const maxRetries = parseInt(values['max-retries'], 10) || 3;

  if (!audioDir) {
    console.error('Error: Missing required option --audio-dir <path>');
    console.error('Run with --help for usage details.');
    return { exitCode: 1 };
  }

  if (!manifestPath) {
    console.error('Error: Missing required option --manifest <path>');
    console.error('Run with --help for usage details.');
    return { exitCode: 1 };
  }

  // Verify paths
  if (!fs.existsSync(audioDir)) {
    console.error(`Error: Audio directory not found: '${audioDir}'`);
    return { exitCode: 1 };
  }
  if (!fs.existsSync(manifestPath)) {
    console.error(`Error: Manifest file not found: '${manifestPath}'`);
    return { exitCode: 1 };
  }

  // Authentication check for execute mode
  const adminKey = process.env.AMBER_ADMIN_API_KEY ? process.env.AMBER_ADMIN_API_KEY.trim() : '';
  if (isExecute && !adminKey) {
    console.error('Error: Administrative API key required for execution.');
    console.error('Please configure the AMBER_ADMIN_API_KEY environment variable before running with --execute.');
    return { exitCode: 1 };
  }

  const client = testOverrides.client || new AmberClient({
    apiUrl,
    adminApiKey: adminKey,
    timeoutMs,
    maxRetries,
    customFetch: testOverrides.customFetch
  });

  console.log('='.repeat(78));
  console.log(' Amber Music Catalogue Bulk Ingestion');
  console.log('='.repeat(78));
  console.log(` Target API   : ${apiUrl}`);
  console.log(` Audio Root   : ${path.resolve(audioDir)}`);
  console.log(` Manifest     : ${path.resolve(manifestPath)}`);
  console.log(` Run Mode     : ${isExecute ? 'EXECUTE (Writing to catalogue)' : 'DRY RUN (Read-only simulation)'}`);
  console.log(` Duplicates   : ${allowDuplicates ? 'ALLOW (Duplicate tracks will be indexed)' : 'SKIP (Existing catalogue duplicates skipped)'}`);
  console.log(` Report File  : ${path.resolve(reportPath)}`);
  console.log('='.repeat(78));

  // 1. Read & parse manifest
  let rawCsv;
  try {
    rawCsv = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    console.error(`Failed to read manifest file: ${err.message}`);
    return { exitCode: 1 };
  }

  let rows;
  try {
    rows = parseCsv(rawCsv, { requiredColumns: REQUIRED_COLUMNS });
  } catch (err) {
    console.error(`Manifest validation failed: ${err.message}`);
    return { exitCode: 1 };
  }

  if (rows.length === 0) {
    console.log('Manifest contains no track entries. Exiting.');
    return { exitCode: 0 };
  }

  console.log(`Parsed ${rows.length} track entry(s) from manifest.`);

  // 2. Fetch existing catalogue for duplicate detection and resume reconciliation
  console.log('Querying current Amber catalogue for existing tracks...');
  const catalogueMap = new Map();
  let catalogueFetchError = null;

  try {
    const existingSongs = await client.fetchCatalogue();
    console.log(`Found ${existingSongs.length} indexed track(s) in database.`);
    for (const song of existingSongs) {
      const key = normalizeTrackKey(song.title, song.artist);
      catalogueMap.set(key, song);
    }
  } catch (err) {
    catalogueFetchError = err;
    console.warn(`Warning: Could not retrieve existing catalogue: ${client.redact(err.message)}`);
  }

  // In EXECUTE mode, fail closed immediately if duplicate protection cannot be verified
  if (isExecute && !allowDuplicates && catalogueFetchError) {
    const failureExplanation = `Duplicate protection could not be verified because catalogue retrieval failed: ${client.redact(catalogueFetchError.message)}. Aborting import before any uploads are sent.`;
    console.error(`\nFatal Error: ${failureExplanation}`);

    const abortReport = {
      timestamp: new Date().toISOString(),
      mode: 'execute',
      apiUrl,
      audioDir: path.resolve(audioDir),
      manifestPath: path.resolve(manifestPath),
      status: 'ABORTED',
      error: client.redact(catalogueFetchError.message),
      reason: failureExplanation,
      summary: {
        total: rows.length,
        successful: 0,
        failed: 0,
        skipped: 0,
        invalid: 0
      },
      results: []
    };
    saveReport(reportPath, abortReport);
    return { exitCode: 1, error: failureExplanation, report: abortReport };
  }

  // 3. Load previous report if resuming and reconcile ambiguous tracks
  const previousResults = new Map();
  if (isResume && fs.existsSync(reportPath)) {
    try {
      const prevData = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      if (Array.isArray(prevData.results)) {
        for (const item of prevData.results) {
          const trackKey = normalizeTrackKey(item.title, item.artist);
          const compositeKey = `${item.relativePath}::${trackKey}`;

          if (item.status === 'SUCCESS' || item.status === 'SKIPPED') {
            previousResults.set(compositeKey, item);
          } else if (item.status === 'AMBIGUOUS') {
            // Reconcile uncertain track against current database catalogue
            if (catalogueMap.has(trackKey)) {
              const existing = catalogueMap.get(trackKey);
              previousResults.set(compositeKey, {
                ...item,
                status: 'SUCCESS',
                songId: existing.id,
                fingerprintCount: existing.fingerprintCount,
                reason: `Reconciled from catalogue: verified indexed with ID ${existing.id}`
              });
              console.log(`[Reconciliation] Ambiguous track "${item.title}" verified in catalogue (ID: ${existing.id}). Marking as completed.`);
            } else {
              console.log(`[Reconciliation] Ambiguous track "${item.title}" was NOT found in catalogue. Re-queuing for safe ingestion.`);
            }
          }
        }
        console.log(`Resuming from existing report: ${previousResults.size} item(s) reconciled or completed.`);
      }
    } catch (err) {
      console.warn(`Could not parse previous report for resume: ${err.message}. Starting fresh.`);
    }
  }

  // 4. Validate all entries
  const manifestSeen = new Set();
  const plan = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const relPath = row.relative_path || '';
    const title = row.title || '';
    const artist = row.artist || '';
    const license = row.license || '';
    const sourceUrl = row.source_url || '';

    const rowTrackKey = normalizeTrackKey(title, artist);
    const resumeKey = `${relPath}::${rowTrackKey}`;

    // If resumed item is already successful or skipped, preserve without re-uploading
    if (previousResults.has(resumeKey)) {
      const prev = previousResults.get(resumeKey);
      plan.push({
        index: i + 1,
        rowNum: row.__rowNum,
        relativePath: relPath,
        title,
        artist,
        license: license.trim() || prev.license || '',
        sourceUrl: sourceUrl.trim() || prev.sourceUrl || '',
        status: prev.status,
        reason: `Preserved from previous run (${prev.reason || 'Completed'})`,
        fullPath: prev.fullPath || path.resolve(audioDir, relPath),
        songId: prev.songId || null,
        fingerprintCount: prev.fingerprintCount || null
      });
      continue;
    }

    // Path validation & Traversal protection & Media preflight
    const pathCheck = validateAudioPath(audioDir, relPath);
    if (!pathCheck.valid) {
      plan.push({
        index: i + 1,
        rowNum: row.__rowNum,
        relativePath: relPath,
        title,
        artist,
        license: license.trim(),
        sourceUrl: sourceUrl.trim(),
        status: 'INVALID',
        reason: pathCheck.error,
        fullPath: pathCheck.fullPath || null
      });
      continue;
    }

    // Metadata validation
    const metaCheck = validateMetadata(title, artist);
    if (!metaCheck.valid) {
      plan.push({
        index: i + 1,
        rowNum: row.__rowNum,
        relativePath: relPath,
        title,
        artist,
        license: license.trim(),
        sourceUrl: sourceUrl.trim(),
        status: 'INVALID',
        reason: metaCheck.error,
        fullPath: pathCheck.fullPath
      });
      continue;
    }

    // Licensing validation
    const licenseCheck = validateLicensing(license, sourceUrl);
    if (!licenseCheck.valid) {
      plan.push({
        index: i + 1,
        rowNum: row.__rowNum,
        relativePath: relPath,
        title,
        artist,
        license: license.trim(),
        sourceUrl: sourceUrl.trim(),
        status: 'INVALID',
        reason: licenseCheck.error,
        fullPath: pathCheck.fullPath
      });
      continue;
    }

    // Duplicate detection
    const trackKey = normalizeTrackKey(title, artist);

    // In-manifest duplicate check
    if (manifestSeen.has(trackKey)) {
      plan.push({
        index: i + 1,
        rowNum: row.__rowNum,
        relativePath: relPath,
        title,
        artist,
        license: licenseCheck.license,
        sourceUrl: licenseCheck.sourceUrl,
        status: 'SKIPPED',
        reason: `Duplicate track in manifest batch ("${title}" by "${artist}")`,
        fullPath: pathCheck.fullPath
      });
      continue;
    }
    manifestSeen.add(trackKey);

    // Existing catalogue duplicate check
    if (!allowDuplicates && catalogueMap.has(trackKey)) {
      const existing = catalogueMap.get(trackKey);
      plan.push({
        index: i + 1,
        rowNum: row.__rowNum,
        relativePath: relPath,
        title,
        artist,
        license: licenseCheck.license,
        sourceUrl: licenseCheck.sourceUrl,
        status: 'SKIPPED',
        reason: `Already indexed in catalogue (ID: ${existing.id}, "${existing.title}" by "${existing.artist}")`,
        fullPath: pathCheck.fullPath
      });
      continue;
    }

    // If catalogue was unreachable in dry-run mode, mark duplicate status as UNKNOWN
    if (!allowDuplicates && catalogueFetchError) {
      plan.push({
        index: i + 1,
        rowNum: row.__rowNum,
        relativePath: relPath,
        title: title.trim(),
        artist: artist.trim(),
        license: licenseCheck.license,
        sourceUrl: licenseCheck.sourceUrl,
        status: 'UNKNOWN',
        duplicateStatus: 'UNKNOWN',
        reason: `Duplicate protection could not be verified (catalogue query failed: ${client.redact(catalogueFetchError.message)})`,
        fullPath: pathCheck.fullPath,
        sizeBytes: pathCheck.sizeBytes,
        validationLevel: pathCheck.validationLevel,
        durationSeconds: pathCheck.durationSeconds,
        mediaWarning: pathCheck.warning || null
      });
      continue;
    }

    // Valid entry ready for upload
    plan.push({
      index: i + 1,
      rowNum: row.__rowNum,
      relativePath: relPath,
      title: title.trim(),
      artist: artist.trim(),
      license: licenseCheck.license,
      sourceUrl: licenseCheck.sourceUrl,
      status: 'PENDING',
      duplicateStatus: 'VERIFIED_NEW',
      reason: 'Valid for ingestion',
      fullPath: pathCheck.fullPath,
      sizeBytes: pathCheck.sizeBytes,
      validationLevel: pathCheck.validationLevel,
      durationSeconds: pathCheck.durationSeconds,
      mediaWarning: pathCheck.warning || null
    });
  }

  // Print planning overview
  const validPending = plan.filter(p => p.status === 'PENDING');
  const unknownItems = plan.filter(p => p.status === 'UNKNOWN');
  const invalidItems = plan.filter(p => p.status === 'INVALID');
  const skippedItems = plan.filter(p => p.status === 'SKIPPED');
  const previousDone = plan.filter(p => p.status === 'SUCCESS');

  console.log('\nValidation & Ingestion Plan:');
  console.log(`- Total Manifest Entries : ${plan.length}`);
  console.log(`- Ready for Ingestion    : ${validPending.length}`);
  console.log(`- Skipped (Duplicates)   : ${skippedItems.length}`);
  if (unknownItems.length > 0) {
    console.log(`- Unknown Duplicate State: ${unknownItems.length} (Catalogue unavailable)`);
  }
  console.log(`- Invalid Entries        : ${invalidItems.length}`);
  if (previousDone.length > 0) {
    console.log(`- Resumed / Reconciled   : ${previousDone.length}`);
  }

  if (invalidItems.length > 0) {
    console.log('\nInvalid Entries:');
    for (const inv of invalidItems) {
      console.log(`  [Row ${inv.rowNum}] ${inv.relativePath}: ${inv.reason}`);
    }
  }

  if (unknownItems.length > 0) {
    console.log('\nUnknown Duplicate Status (Catalogue Unreachable):');
    for (const unk of unknownItems) {
      console.log(`  [Row ${unk.rowNum}] "${unk.title}" by "${unk.artist}": ${unk.reason}`);
    }
  }

  if (skippedItems.length > 0) {
    console.log('\nSkipped Entries:');
    for (const skp of skippedItems) {
      console.log(`  [Row ${skp.rowNum}] "${skp.title}" by "${skp.artist}": ${skp.reason}`);
    }
  }

  // DRY RUN EXIT
  if (!isExecute) {
    console.log('\n' + '='.repeat(78));
    console.log(' *** DRY RUN COMPLETE: 0 tracks uploaded. ***');
    if (catalogueFetchError) {
      console.log(' WARNING: Duplicate status is UNKNOWN because catalogue could not be retrieved.');
      console.log(' Never assume duplicate protection succeeded when the catalogue check fails.');
    } else {
      console.log(` Actions that would be taken: ${validPending.length} track(s) would be uploaded.`);
    }
    console.log(' To execute uploads, run with --execute and ensure AMBER_ADMIN_API_KEY is configured.');
    console.log('='.repeat(78));

    const dryRunReport = {
      timestamp: new Date().toISOString(),
      mode: 'dry-run',
      apiUrl,
      audioDir: path.resolve(audioDir),
      manifestPath: path.resolve(manifestPath),
      catalogueStatus: catalogueFetchError ? 'UNAVAILABLE' : 'VERIFIED',
      catalogueError: catalogueFetchError ? client.redact(catalogueFetchError.message) : null,
      summary: {
        total: plan.length,
        ready: validPending.length,
        unknownDuplicates: unknownItems.length,
        skipped: skippedItems.length,
        invalid: invalidItems.length
      },
      results: plan
    };
    saveReport(reportPath, dryRunReport);
    return { exitCode: 0, report: dryRunReport };
  }

  // EXECUTION MODE
  console.log('\n' + '='.repeat(78));
  console.log(` Commencing Ingestion of ${validPending.length} Track(s)`);
  console.log('='.repeat(78));

  let successCount = 0;
  let failCount = 0;
  let pausedForAmbiguity = false;

  for (let idx = 0; idx < plan.length; idx++) {
    const item = plan[idx];
    if (item.status !== 'PENDING') {
      continue;
    }

    const counter = `[${idx + 1}/${plan.length}]`;
    process.stdout.write(`${counter} Ingesting "${item.title}" by "${item.artist}" (${path.basename(item.fullPath)})... `);

    try {
      const response = await client.uploadSong(item.fullPath, item.title, item.artist);
      item.status = 'SUCCESS';
      item.songId = response.id;
      item.fingerprintCount = response.fingerprintCount;
      item.durationMs = response.durationMs;
      item.reason = `Indexed successfully (ID: ${response.id}, fingerprints: ${response.fingerprintCount})`;
      item.error = null;
      successCount++;
      console.log(`✓ OK (ID: ${response.id}, ${response.fingerprintCount} fingerprints, ${(response.durationMs / 1000).toFixed(1)}s)`);
    } catch (err) {
      failCount++;
      const isAmbiguous = Boolean(err.isAmbiguous);
      item.error = client.redact(err.message);

      if (isAmbiguous) {
        item.status = 'AMBIGUOUS';
        item.reason = `Upload outcome ambiguous: ${item.error}. Ingestion halted to prevent duplicate uploads.`;
        pausedForAmbiguity = true;
        console.log(`\n⚠ AMBIGUOUS UPLOAD: ${item.error}`);
        console.error(`Halting further ingestion. Outcome for track "${item.title}" by "${item.artist}" cannot be verified without reconciliation.`);

        // Save report immediately with AMBIGUOUS status
        saveReport(reportPath, {
          timestamp: new Date().toISOString(),
          mode: 'execute',
          apiUrl,
          audioDir: path.resolve(audioDir),
          manifestPath: path.resolve(manifestPath),
          catalogueStatus: 'VERIFIED',
          reconciliationRequired: true,
          ambiguousTrack: {
            title: item.title,
            artist: item.artist,
            relativePath: item.relativePath
          },
          summary: {
            total: plan.length,
            successful: successCount + previousDone.length,
            failed: failCount,
            skipped: skippedItems.length,
            invalid: invalidItems.length
          },
          results: plan
        });

        // Halt further ingestion immediately!
        break;
      }

      item.status = 'FAILED';
      item.reason = `Upload failed: ${item.error}`;
      console.log(`✗ FAILED: ${item.error}`);
    }

    // Save incremental progress after each item for resume capability
    saveReport(reportPath, {
      timestamp: new Date().toISOString(),
      mode: 'execute',
      apiUrl,
      audioDir: path.resolve(audioDir),
      manifestPath: path.resolve(manifestPath),
      catalogueStatus: 'VERIFIED',
      summary: {
        total: plan.length,
        successful: successCount + previousDone.length,
        failed: failCount,
        skipped: skippedItems.length,
        invalid: invalidItems.length
      },
      results: plan
    });
  }

  console.log('\n' + '='.repeat(78));
  console.log(pausedForAmbiguity ? ' Ingestion Halted (Reconciliation Required)' : ' Ingestion Complete');
  console.log('='.repeat(78));
  console.log(`- Successfully Indexed : ${successCount + previousDone.length}`);
  console.log(`- Failed / Ambiguous   : ${failCount}`);
  console.log(`- Skipped              : ${skippedItems.length}`);
  console.log(`- Invalid              : ${invalidItems.length}`);
  console.log(`- Full Report Saved To : ${path.resolve(reportPath)}`);
  if (pausedForAmbiguity) {
    console.log(' Note: To reconcile, re-run with --resume after verifying backend status.');
  }
  console.log('='.repeat(78));

  return {
    exitCode: failCount > 0 ? 1 : 0,
    results: plan
  };
}

function saveReport(reportPath, data) {
  try {
    const dir = path.dirname(path.resolve(reportPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(reportPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Warning: Failed to save report to ${reportPath}: ${err.message}`);
  }
}

function printHelp() {
  console.log(`
Amber Bulk Catalogue Ingestion Tool

Usage:
  node scripts/bulk-import.mjs --audio-dir <path> --manifest <path> [options]

Required Options:
  -d, --audio-dir <path>     Directory containing audio files.
  -m, --manifest <path>      Path to CSV manifest file.

General Options:
  -u, --api-url <url>        Amber API base URL (default: http://localhost:8080/api/v1).
  --execute                  Execute actual uploads. Default is safe DRY RUN mode.
  -r, --report <path>        Path for progress/summary JSON report (default: ./bulk-import-report.json).
  --resume                   Resume an interrupted run, skipping or reconciling completed tracks.
  --allow-duplicates         Upload tracks even if they already exist in catalogue.
  --timeout <ms>             HTTP request timeout in ms (default: 30000).
  --max-retries <n>          Max retry attempts for safe transient server errors (default: 3).
  -h, --help                 Display this help reference.

CSV Manifest Format:
  relative_path,title,artist,license,source_url
  track1.wav,Midnight Rain,Acoustic Duo,CC-BY-4.0,https://example.org/audio1.wav

Safety Features:
  - Fails closed in --execute mode if catalogue duplicate detection fails.
  - Halts on ambiguous upload errors (timeouts / 5xx) to prevent duplicate uploads.
  - Reconciles uncertain tracks against remote catalogue on --resume.
  - Strict preflight media validation (format, duration bounds [1s, 600s], RMS non-silence >= 1e-5).
  - Mandatory licensing metadata (license ID and valid HTTP/HTTPS source URL).
`);
}

// Execute if run directly from CLI
if (process.argv[1] && process.argv[1].endsWith('bulk-import.mjs')) {
  runBulkImport().then(({ exitCode }) => {
    process.exit(exitCode);
  }).catch((err) => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}
