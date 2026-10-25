import React from 'react';
import { CheckCircle2, XCircle, Clock, Zap, Hash, AlignLeft } from 'lucide-react';
import type { MatchResponse } from '../types/api';

interface MatchResultCardProps {
  result: MatchResponse;
}

export const MatchResultCard: React.FC<MatchResultCardProps> = ({ result }) => {
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

  // Format offset in minutes:seconds.fraction
  const formatOffset = (ms: number) => {
    const isNegative = ms < 0;
    const absMs = Math.abs(ms);
    const totalSecs = Math.floor(absMs / 1000);
    const minutes = Math.floor(totalSecs / 60);
    const seconds = totalSecs % 60;
    const millis = absMs % 1000;
    return `${isNegative ? '-' : ''}${minutes}:${seconds.toString().padStart(2, '0')}.${Math.floor(millis / 100)}s`;
  };

  // Prepare histogram buckets for visual inspection
  const histogramEntries = diagnostics?.histogram
    ? Object.entries(diagnostics.histogram)
        .map(([k, v]) => ({ bucket: Number(k), votes: v }))
        .sort((a, b) => a.bucket - b.bucket)
    : [];

  const maxVotes = Math.max(...histogramEntries.map((e) => e.votes), 1);

  return (
    <div className={`mt-6 rounded-2xl border p-6 transition-all duration-300 shadow-xl backdrop-blur-md ${
      matched
        ? 'bg-slate-900/90 border-cyan-500/30 ring-1 ring-cyan-500/20'
        : 'bg-slate-900/80 border-slate-800'
    }`}>
      {/* Header status */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          {matched ? (
            <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
          ) : (
            <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl flex items-center justify-center">
              <XCircle className="w-6 h-6" />
            </div>
          )}
          <div>
            <h3 className="text-lg font-bold text-white">
              {matched ? 'Track Identified' : 'No Confident Match'}
            </h3>
            <p className="text-xs text-slate-400">
              {matched
                ? 'Time-coherent constellation peak detected'
                : message || 'Query fingerprints showed insufficient time coherence'}
            </p>
          </div>
        </div>

        {/* Confidence pill */}
        <div className="text-right">
          <div className="text-xs text-slate-400 mb-0.5">Confidence</div>
          <span className={`inline-block px-3 py-1 rounded-full text-xs font-mono font-bold ${
            confidence > 0.6
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : confidence > 0.3
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : 'bg-slate-800 text-slate-400'
          }`}>
            {(confidence * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Identified Track Details */}
      {matched && song && (
        <div className="py-5 border-b border-slate-800">
          <div className="text-xs font-semibold text-cyan-400 tracking-wider uppercase mb-1">
            Matching Song
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight">{song.title}</h2>
          <div className="text-sm font-medium text-slate-300 mt-0.5">by {song.artist}</div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span>Estimated Offset</span>
              </div>
              <div className="text-base font-mono font-bold text-white">
                {formatOffset(estimatedOffsetMs)}
              </div>
            </div>

            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                <Hash className="w-3.5 h-3.5 text-cyan-400" />
                <span>Matched Hashes</span>
              </div>
              <div className="text-base font-mono font-bold text-white">
                {matchedFingerprints} <span className="text-xs text-slate-500">/ {totalQueryFingerprints}</span>
              </div>
            </div>

            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                <Zap className="w-3.5 h-3.5 text-cyan-400" />
                <span>Peak Votes</span>
              </div>
              <div className="text-base font-mono font-bold text-white">
                {diagnostics?.peakVotes ?? matchedFingerprints}
              </div>
            </div>

            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                <AlignLeft className="w-3.5 h-3.5 text-cyan-400" />
                <span>Search Latency</span>
              </div>
              <div className="text-base font-mono font-bold text-white">
                {processingTimeMs.toFixed(1)} ms
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Offset Histogram Visualization */}
      {histogramEntries.length > 0 && (
        <div className="pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase">
              Time-Offset Histogram (Δt = t_db - t_query)
            </span>
            <span className="text-xs text-slate-500 font-mono">
              Coherence Score: {diagnostics?.coherenceScore?.toFixed(2) ?? '—'}
            </span>
          </div>

          <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800/80">
            <div className="h-24 flex items-end gap-1.5 w-full overflow-x-auto pb-1">
              {histogramEntries.map(({ bucket, votes }) => {
                const heightPercent = Math.max((votes / maxVotes) * 100, 6);
                const isPeak = votes === maxVotes;
                return (
                  <div
                    key={bucket}
                    className="flex-1 min-w-[12px] flex flex-col items-center group relative cursor-pointer"
                  >
                    {/* Tooltip */}
                    <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                      <div className="bg-slate-800 text-[10px] text-white font-mono px-2 py-0.5 rounded shadow border border-slate-700 whitespace-nowrap">
                        {bucket}ms: {votes} votes
                      </div>
                    </div>
                    {/* Bar */}
                    <div
                      style={{ height: `${heightPercent}%` }}
                      className={`w-full rounded-t transition-all ${
                        isPeak
                          ? 'bg-gradient-to-t from-cyan-600 to-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.5)]'
                          : 'bg-slate-700 hover:bg-slate-600'
                      }`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1 px-1">
              <span>{histogramEntries[0]?.bucket}ms</span>
              <span className="text-cyan-400 font-semibold">Peak: {diagnostics?.peakOffsetBucketMs}ms</span>
              <span>{histogramEntries[histogramEntries.length - 1]?.bucket}ms</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
