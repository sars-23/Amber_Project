import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, Clock, Hash, Zap, Timer, ChevronDown, ChevronUp } from 'lucide-react';
import type { MatchResponse } from '../types/api';

interface MatchResultCardProps {
  result: MatchResponse;
}

export const MatchResultCard: React.FC<MatchResultCardProps> = ({ result }) => {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState<boolean>(false);

  const {
    matched,
    song,
    confidence,
    estimatedOffsetMs,
    matchedFingerprints,
    totalQueryFingerprints,
    processingTimeMs,
    diagnostics,
    message,
  } = result;

  // Format offset in minutes:seconds.centiseconds
  const formatOffset = (ms?: number) => {
    if (typeof ms !== 'number' || isNaN(ms)) return '0:00.0s';
    const isNegative = ms < 0;
    const absMs = Math.abs(ms);
    const totalSecs = Math.floor(absMs / 1000);
    const minutes = Math.floor(totalSecs / 60);
    const seconds = totalSecs % 60;
    const millis = absMs % 1000;
    return `${isNegative ? '-' : ''}${minutes}:${seconds.toString().padStart(2, '0')}.${Math.floor(millis / 100)}s`;
  };

  // Safe timing & confidence calculations
  const rawLatency = processingTimeMs ?? result.searchDurationMs;
  const latencyDisplay = typeof rawLatency === 'number' && !isNaN(rawLatency) ? `${rawLatency.toFixed(1)} ms` : '—';

  const safeConfidence = typeof confidence === 'number' && !isNaN(confidence) ? confidence : 0;
  const confidencePercent = `${(safeConfidence * 100).toFixed(1)}%`;

  const effectiveMatchedHashes = matchedFingerprints ?? result.matchingHashes ?? 0;
  const effectiveTotalQueryFPs = totalQueryFingerprints ?? 0;
  const effectiveOffset = estimatedOffsetMs ?? 0;

  // Prepare histogram buckets from either diagnostics.histogram or result.offsetHistogram
  const histogramEntries = diagnostics?.histogram
    ? Object.entries(diagnostics.histogram)
        .map(([k, v]) => ({ bucket: Number(k), votes: v }))
        .sort((a, b) => a.bucket - b.bucket)
    : Array.isArray(result.offsetHistogram)
    ? result.offsetHistogram
        .map((b) => ({ bucket: b.offsetMs, votes: b.votes }))
        .sort((a, b) => a.bucket - b.bucket)
    : [];

  const maxVotes = Math.max(...histogramEntries.map((e) => e.votes), 1);

  if (!matched) {
    return (
      <div className="mt-6 bg-white border border-gray-200 rounded-xl p-6 shadow-sm animate-in fade-in">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 flex-shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">
                No Confident Match Found
              </h3>
              <span className="text-xs font-mono font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
                {confidencePercent} confidence
              </span>
            </div>
            <p className="text-sm text-gray-600 mt-1">
              {message || 'The audio query constellation did not align with any recording in Amber\'s indexed catalog.'}
            </p>
            <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500 space-y-1">
              <p className="font-medium text-gray-700">Troubleshooting tips:</p>
              <ul className="list-disc list-inside space-y-0.5 text-gray-600">
                <li>Check that the source song is indexed in the <span className="font-medium text-gray-800">Library</span>.</li>
                <li>Provide a longer excerpt (3–10 seconds provides more constellation peak pairs).</li>
                <li>Ensure the audio clip contains recognizable melodic or harmonic content.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 bg-white border border-gray-200 rounded-xl p-6 shadow-sm animate-in fade-in">
      {/* Success Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 flex-shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Match Identified
            </span>
            <h3 className="text-xl font-bold text-gray-900 leading-tight">
              {song?.title}
            </h3>
            <p className="text-sm text-gray-600 font-medium">
              by {song?.artist}
            </p>
          </div>
        </div>

        {/* Confidence badge */}
        <div className="flex sm:flex-col items-center sm:items-end justify-between">
          <span className="text-xs text-gray-500 mb-0.5 sm:block">Match Confidence</span>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-mono font-semibold ${
            safeConfidence >= 0.7
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : safeConfidence >= 0.4
              ? 'bg-amber-50 text-amber-800 border border-amber-200'
              : 'bg-gray-100 text-gray-700'
          }`}>
            {confidencePercent} match
          </span>
        </div>
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-4">
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <Clock className="w-3.5 h-3.5 text-gray-400" />
            <span>Offset</span>
          </div>
          <div className="text-sm font-semibold font-mono text-gray-900">
            {formatOffset(effectiveOffset)}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">Position in song</div>
        </div>

        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <Hash className="w-3.5 h-3.5 text-gray-400" />
            <span>Matched Hashes</span>
          </div>
          <div className="text-sm font-semibold font-mono text-gray-900">
            {effectiveMatchedHashes} <span className="text-xs text-gray-500">/ {effectiveTotalQueryFPs}</span>
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">Constellation pairs</div>
        </div>

        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <Zap className="w-3.5 h-3.5 text-gray-400" />
            <span>Peak Votes</span>
          </div>
          <div className="text-sm font-semibold font-mono text-gray-900">
            {diagnostics?.peakVotes ?? effectiveMatchedHashes}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">Coherent offset bin</div>
        </div>

        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <Timer className="w-3.5 h-3.5 text-gray-400" />
            <span>Search Latency</span>
          </div>
          <div className="text-sm font-semibold font-mono text-gray-900">
            {latencyDisplay}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">Lookup duration</div>
        </div>
      </div>

      {/* Progressive Disclosure Toggle */}
      {histogramEntries.length > 0 && (
        <div className="pt-2 border-t border-gray-100">
          <button
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            className="flex items-center justify-between w-full py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
          >
            <span>Time-offset histogram and coherence diagnostics</span>
            {showTechnicalDetails ? (
              <ChevronUp className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            )}
          </button>

          {showTechnicalDetails && (
            <div className="mt-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between mb-3 text-xs">
                <span className="font-medium text-gray-700">Offset Histogram (Δt = t_catalog − t_query)</span>
                <span className="font-mono text-gray-500">
                  Coherence Score: {typeof diagnostics?.coherenceScore === 'number' && !isNaN(diagnostics.coherenceScore) ? diagnostics.coherenceScore.toFixed(2) : (typeof (result as any).score === 'number' ? (result as any).score.toFixed(2) : '—')}
                </span>
              </div>

              {/* Histogram Bars */}
              <div className="h-24 flex items-end gap-1 w-full overflow-x-auto pb-1 bg-white p-2 rounded border border-gray-200">
                {histogramEntries.map(({ bucket, votes }) => {
                  const heightPercent = Math.max((votes / maxVotes) * 100, 6);
                  const isPeak = votes === maxVotes;
                  return (
                    <div
                      key={bucket}
                      className="flex-1 min-w-[10px] flex flex-col items-center group relative cursor-pointer"
                    >
                      <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                        <div className="bg-gray-800 text-[10px] text-white font-mono px-2 py-0.5 rounded shadow whitespace-nowrap">
                          {bucket}ms: {votes} votes
                        </div>
                      </div>
                      <div
                        style={{ height: `${heightPercent}%` }}
                        className={`w-full rounded-t transition-all ${
                          isPeak
                            ? 'bg-amber-600'
                            : 'bg-gray-300 hover:bg-gray-400'
                        }`}
                      />
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-between text-[11px] text-gray-500 font-mono mt-1 px-1">
                <span>{histogramEntries[0]?.bucket}ms</span>
                <span className="text-amber-700 font-medium">Peak bucket: {diagnostics?.peakOffsetBucketMs ?? effectiveOffset}ms</span>
                <span>{histogramEntries[histogramEntries.length - 1]?.bucket}ms</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
