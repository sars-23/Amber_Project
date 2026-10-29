#!/usr/bin/env node

/**
 * Amber Recognition-Quality Evaluation Tool
 *
 * Runs repeatable acoustic matching evaluations against an Amber instance (POST /api/v1/search).
 * Computes song-identification accuracy, false positives/negatives, offset MAE, and latency percentiles.
 *
 * Defaults to safe Dry Run mode unless --execute is explicitly passed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseCsv, stringifyCsv } from './lib/csv-parser.mjs';
import { validateAudioPath } from './lib/audio-validator.mjs';
import { AmberClient } from './lib/amber-client.mjs';
import { calculateEvaluationMetrics } from './lib/metrics.mjs';

export async function runEvaluation(cliArgs = process.argv.slice(2)) {
  const options = {
    'audio-dir': { type: 'string', short: 'd' },
    'manifest': { type: 'string', short: 'm' },
    'api-url': { type: 'string', short: 'u', default: 'http://localhost:8080/api/v1' },
    'execute': { type: 'boolean', default: false },
    'report-json': { type: 'string', default: './evaluation-report.json' },
    'report-csv': { type: 'string' },
    'concurrency': { type: 'string', default: '1' },
    'timeout': { type: 'string', default: '15000' },
    'offset-tolerance-ms': { type: 'string', default: '250' },
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
  const reportJsonPath = values['report-json'];
  const reportCsvPath = values['report-csv'];
  const concurrency = Math.min(4, Math.max(1, parseInt(values.concurrency, 10) || 1));
  const timeoutMs = parseInt(values.timeout, 10) || 15_000;
  const offsetToleranceMs = parseInt(values['offset-tolerance-ms'], 10) || 250;

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

  if (!fs.existsSync(audioDir)) {
    console.error(`Error: Audio directory not found: '${audioDir}'`);
    return { exitCode: 1 };
  }
  if (!fs.existsSync(manifestPath)) {
    console.error(`Error: Manifest file not found: '${manifestPath}'`);
    return { exitCode: 1 };
  }

  const client = new AmberClient({
    apiUrl,
    timeoutMs,
    maxRetries: 3
  });

  console.log('='.repeat(78));
  console.log(' Amber Recognition-Quality Evaluation');
  console.log('='.repeat(78));
  console.log(` Target API        : ${apiUrl}`);
  console.log(` Audio Root        : ${path.resolve(audioDir)}`);
  console.log(` Manifest          : ${path.resolve(manifestPath)}`);
  console.log(` Run Mode          : ${isExecute ? 'EXECUTE (Querying live search API)' : 'DRY RUN (Validating fixtures & plan)'}`);
  console.log(` Concurrency       : ${concurrency} query worker(s)`);
  console.log(` Offset Tolerance  : ±${offsetToleranceMs} ms`);
  console.log(` JSON Report       : ${path.resolve(reportJsonPath)}`);
  if (reportCsvPath) {
    console.log(` CSV Export        : ${path.resolve(reportCsvPath)}`);
  }
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
    rows = parseCsv(rawCsv);
  } catch (err) {
    console.error(`Manifest parse error: ${err.message}`);
    return { exitCode: 1 };
  }

  if (rows.length === 0) {
    console.log('Manifest contains no query rows. Exiting.');
    return { exitCode: 0 };
  }

  // 2. Validate query fixtures
  const plan = [];
  const invalidItems = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Map column aliases
    const queryRelPath = row.query_path || row.relative_path || row.file_path || '';
    const expectedTitle = row.expected_title || row.title || '';
    const expectedArtist = row.expected_artist || row.artist || '';
    const rawOffset = row.expected_offset_ms || row.offset_ms || '';
    const expectedOffsetMs = rawOffset !== '' && !isNaN(parseInt(rawOffset, 10))
      ? parseInt(rawOffset, 10)
      : null;
    const label = row.label || row.condition || 'default';

    const pathCheck = validateAudioPath(audioDir, queryRelPath);
    if (!pathCheck.valid) {
      invalidItems.push({
        rowNum: row.__rowNum,
        path: queryRelPath,
        error: pathCheck.error
      });
      continue;
    }

    plan.push({
      index: plan.length + 1,
      rowNum: row.__rowNum,
      queryPath: queryRelPath,
      fullPath: pathCheck.fullPath,
      sizeBytes: pathCheck.sizeBytes,
      expectedTitle: expectedTitle.trim(),
      expectedArtist: expectedArtist.trim(),
      expectedOffsetMs,
      label: label.trim()
    });
  }

  console.log(`\nManifest Inspection:`);
  console.log(`- Total Query Rows     : ${rows.length}`);
  console.log(`- Valid Query Fixtures : ${plan.length}`);
  console.log(`- Invalid Fixtures     : ${invalidItems.length}`);

  if (invalidItems.length > 0) {
    console.log('\nInvalid Fixture Details:');
    for (const inv of invalidItems) {
      console.log(`  [Row ${inv.rowNum}] ${inv.path}: ${inv.error}`);
    }
  }

  // DRY RUN EXIT
  if (!isExecute) {
    console.log('\n' + '='.repeat(78));
    console.log(' *** DRY RUN COMPLETE: 0 search queries executed. ***');
    console.log(` Actions that would be taken: ${plan.length} query excerpt(s) would be submitted to POST /api/v1/search.`);
    console.log(' To execute evaluation against target API, re-run with --execute.');
    console.log('='.repeat(78));

    const dryRunReport = {
      timestamp: new Date().toISOString(),
      mode: 'dry-run',
      apiUrl,
      audioDir: path.resolve(audioDir),
      manifestPath: path.resolve(manifestPath),
      totalQueriesPlanned: plan.length,
      invalidFixturesCount: invalidItems.length,
      fixtures: plan
    };
    saveJson(reportJsonPath, dryRunReport);
    return { exitCode: 0, report: dryRunReport };
  }

  // EXECUTION MODE
  console.log('\n' + '='.repeat(78));
  console.log(` Commencing Evaluation of ${plan.length} Query Excerpt(s)`);
  console.log('='.repeat(78));

  const queryResults = [];
  let completed = 0;

  // Process with concurrency
  async function worker(items) {
    for (const item of items) {
      completed++;
      const prefix = `[${completed}/${plan.length}]`;
      const queryName = path.basename(item.fullPath);
      process.stdout.write(`${prefix} Searching '${queryName}' (label: ${item.label})... `);

      const record = {
        ...item,
        matched: false,
        matchedSong: null,
        estimatedOffsetMs: null,
        score: null,
        confidence: null,
        latencyMs: null,
        error: null
      };

      try {
        const { result, latencyMs } = await client.searchAudio(item.fullPath);
        record.matched = Boolean(result.matched);
        record.matchedSong = result.song || null;
        record.estimatedOffsetMs = result.estimatedOffsetMs !== undefined ? result.estimatedOffsetMs : null;
        record.score = result.score || 0;
        record.confidence = result.confidence || 0;
        record.latencyMs = latencyMs;

        if (record.matched && record.matchedSong) {
          const isExpected = record.expectedTitle &&
            record.matchedSong.title.toLowerCase().trim() === record.expectedTitle.toLowerCase().trim();

          const offsetInfo = typeof item.expectedOffsetMs === 'number'
            ? ` | Offset: ${record.estimatedOffsetMs}ms (err: ${Math.abs(record.estimatedOffsetMs - item.expectedOffsetMs)}ms)`
            : '';

          console.log(`✓ Matched '${record.matchedSong.title}' (${latencyMs}ms${offsetInfo})`);
        } else {
          console.log(`○ No match found (${latencyMs}ms)`);
        }
      } catch (err) {
        record.error = client.redact(err.message);
        console.log(`✗ Error: ${record.error}`);
      }

      queryResults.push(record);
    }
  }

  // Chunk for concurrency
  const chunks = Array.from({ length: concurrency }, () => []);
  for (let i = 0; i < plan.length; i++) {
    chunks[i % concurrency].push(plan[i]);
  }
  await Promise.all(chunks.map(chunk => worker(chunk)));

  // Calculate metrics
  const metrics = calculateEvaluationMetrics(queryResults, { offsetToleranceMs });

  // Print Summary Table
  console.log('\n' + '='.repeat(78));
  console.log(' EVALUATION METRICS REPORT');
  console.log('='.repeat(78));
  console.log(` Total Queries Executed    : ${metrics.summary.totalExecuted}`);
  console.log(` Failed Requests (Errors)  : ${metrics.summary.failedRequests}`);
  console.log(` Expected Target Songs     : ${metrics.summary.expectedMatches}`);
  console.log(` Negative Control Excerpts : ${metrics.summary.negativeControls}`);
  console.log('-'.repeat(78));
  console.log(` Correct Identifications   : ${metrics.summary.correctMatches} (${metrics.summary.identificationRatePercent}%)`);
  console.log(` Missed Expected Matches   : ${metrics.summary.missedExpectedMatches} (${metrics.summary.missedRatePercent}%)`);
  console.log(` Wrong-Song Identifications: ${metrics.summary.wrongSongIdentifications} (${metrics.summary.wrongSongRatePercent}%)`);
  console.log('-'.repeat(78));
  if (metrics.summary.negativeControls > 0) {
    console.log(` Negative True Negatives   : ${metrics.summary.negativeControlTrueNegatives} (${metrics.summary.trueNegativeRatePercent}%)`);
    console.log(` Negative False Positives  : ${metrics.summary.negativeControlFalsePositives} (${metrics.summary.falsePositiveRatePercent}%)`);
    console.log('-'.repeat(78));
  } else {
    console.log(` Negative Control FPR      : N/A (No negative controls in dataset)`);
    console.log('-'.repeat(78));
  }
  const precStr = metrics.summary.precisionPercent !== null ? `${metrics.summary.precisionPercent}%` : 'N/A';
  const recStr = metrics.summary.recallPercent !== null ? `${metrics.summary.recallPercent}%` : 'N/A';
  const fnrStr = metrics.summary.falseNegativeRatePercent !== null ? `${metrics.summary.falseNegativeRatePercent}%` : 'N/A';
  console.log(` Precision                 : ${precStr}`);
  console.log(` Recall                    : ${recStr}`);
  console.log(` False Negative Rate (FNR) : ${fnrStr}`);
  console.log('-'.repeat(78));
  if (metrics.offsetAccuracy.evaluatedCount > 0) {
    console.log(` Evaluated Offsets         : ${metrics.offsetAccuracy.evaluatedCount} (Unavailable: ${metrics.offsetAccuracy.unavailableCount})`);
    console.log(` Within Tolerance (±${metrics.offsetAccuracy.toleranceMs}ms) : ${metrics.offsetAccuracy.withinToleranceCount} (${metrics.offsetAccuracy.withinToleranceRatePercent}%)`);
    console.log(` Mean Absolute Error (MAE) : ${metrics.offsetAccuracy.meanAbsoluteErrorMs} ms`);
    console.log(` Min / Max Offset Error    : ${metrics.offsetAccuracy.minErrorMs} ms / ${metrics.offsetAccuracy.maxErrorMs} ms`);
    console.log('-'.repeat(78));
  } else if (metrics.offsetAccuracy.unavailableCount > 0) {
    console.log(` Offset Measurements       : 0 evaluated (${metrics.offsetAccuracy.unavailableCount} unavailable/missing from response)`);
    console.log('-'.repeat(78));
  }
  if (metrics.latencyDistribution.sampleCount > 0) {
    console.log(` Search Latency (p50 Med)  : ${metrics.latencyDistribution.p50MedianMs} ms`);
    console.log(` Search Latency (p95)      : ${metrics.latencyDistribution.p95Ms} ms`);
    console.log(` Min / Mean / Max Latency  : ${metrics.latencyDistribution.minMs} ms / ${metrics.latencyDistribution.meanMs} ms / ${metrics.latencyDistribution.maxMs} ms`);
    console.log('-'.repeat(78));
  }

  // Label breakdown
  const labels = Object.keys(metrics.breakdownByLabel);
  if (labels.length > 1 || (labels.length === 1 && labels[0] !== 'default')) {
    console.log(' Segmented Accuracy Breakdown:');
    for (const [lbl, b] of Object.entries(metrics.breakdownByLabel)) {
      const maeStr = b.offsetMaeMs !== null ? ` | Offset MAE: ${b.offsetMaeMs}ms` : '';
      console.log(`   [${lbl.padEnd(16)}] Identification Rate: ${b.identificationRatePercent}% (${b.correctMatches}/${b.expectedMatches})${maeStr} | Med Latency: ${b.medianLatencyMs}ms`);
    }
    console.log('-'.repeat(78));
  }

  const fullReport = {
    timestamp: new Date().toISOString(),
    apiUrl,
    audioDir: path.resolve(audioDir),
    manifestPath: path.resolve(manifestPath),
    metrics,
    results: queryResults.map(q => ({
      queryPath: q.queryPath,
      label: q.label,
      expectedTitle: q.expectedTitle,
      expectedArtist: q.expectedArtist,
      expectedOffsetMs: q.expectedOffsetMs,
      matched: q.matched,
      matchedTitle: q.matchedSong ? q.matchedSong.title : null,
      matchedArtist: q.matchedSong ? q.matchedSong.artist : null,
      estimatedOffsetMs: q.estimatedOffsetMs,
      offsetErrorMs: (typeof q.expectedOffsetMs === 'number' && typeof q.estimatedOffsetMs === 'number' && !isNaN(q.estimatedOffsetMs))
        ? Math.abs(q.estimatedOffsetMs - q.expectedOffsetMs)
        : null,
      confidence: q.confidence,
      score: q.score,
      latencyMs: q.latencyMs,
      error: q.error
    }))
  };

  saveJson(reportJsonPath, fullReport);
  console.log(` Full JSON Report Saved    : ${path.resolve(reportJsonPath)}`);

  if (reportCsvPath) {
    const csvColumns = [
      'queryPath', 'label', 'expectedTitle', 'expectedArtist', 'expectedOffsetMs',
      'matched', 'matchedTitle', 'matchedArtist', 'estimatedOffsetMs', 'offsetErrorMs',
      'confidence', 'score', 'latencyMs', 'error'
    ];
    try {
      const csvData = stringifyCsv(fullReport.results, csvColumns);
      fs.writeFileSync(reportCsvPath, csvData, 'utf8');
      console.log(` Detailed CSV Export Saved : ${path.resolve(reportCsvPath)}`);
    } catch (err) {
      console.error(` Failed to save CSV export: ${err.message}`);
    }
  }

  console.log('='.repeat(78));

  return { exitCode: 0, report: fullReport };
}

function saveJson(filePath, data) {
  try {
    const dir = path.dirname(path.resolve(filePath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Warning: Failed to write JSON report to ${filePath}: ${err.message}`);
  }
}

function printHelp() {
  console.log(`
Amber Recognition-Quality Evaluation Tool

Usage:
  node scripts/recognition-evaluator.mjs --audio-dir <path> --manifest <path> [options]

Required Options:
  -d, --audio-dir <path>             Directory containing query audio excerpts.
  -m, --manifest <path>              Path to evaluation CSV manifest file.

General Options:
  -u, --api-url <url>                Amber API base URL (default: http://localhost:8080/api/v1).
  --execute                          Execute actual queries against API. Default is DRY RUN mode.
  --report-json <path>               Path for output JSON metrics report (default: ./evaluation-report.json).
  --report-csv <path>                Optional path to export detailed per-query CSV results.
  --concurrency <n>                  Max parallel query workers (1-4, default: 1).
  --timeout <ms>                     Query request timeout in ms (default: 15000).
  --offset-tolerance-ms <n>          Acceptable offset tolerance in ms (default: 250).
  -h, --help                         Display this help reference.

Evaluation Manifest CSV Format:
  query_path,expected_title,expected_artist,expected_offset_ms,label
  excerpt_01.wav,Midnight Rain,Acoustic Duo,3000,clean-crop
  excerpt_noisy.wav,Midnight Rain,Acoustic Duo,3000,snr-6db
  ambient_noise.wav,,,,negative-control

Notes:
  - Songs must already be indexed in the Amber catalogue before running evaluation.
  - Identification accuracy is calculated strictly from title/artist verification.
  - Offset accuracy is evaluated independently for correctly matched songs.
`);
}

// Execute if run directly from CLI
if (process.argv[1] && process.argv[1].endsWith('recognition-evaluator.mjs')) {
  runEvaluation().then(({ exitCode }) => {
    process.exit(exitCode);
  }).catch((err) => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}
