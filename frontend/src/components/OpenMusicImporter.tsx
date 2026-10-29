import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, CheckCircle2, Download, ExternalLink, Globe, Loader2, Music2,
  RefreshCw, Search, ShieldCheck, XCircle,
} from 'lucide-react';
import {
  cancelOpenMusicImport,
  fetchActiveOpenMusicJobs,
  fetchOpenMusicImportJob,
  OpenMusicError,
  retryFailedOpenMusicImport,
  searchOpenMusicTracks,
  startOpenMusicImport,
} from '../services/openMusicApi';
import type { JamendoTrack, OpenMusicImportJob } from '../types/openMusic';

interface OpenMusicImporterProps {
  onImportComplete: () => void;
  onNavigateToCatalog: () => void;
}

const TERMINAL_STATES = new Set(['COMPLETED', 'COMPLETED_WITH_ERRORS', 'CANCELLED']);

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

function humanBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 1) return '—';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusTone(status: string): string {
  if (status === 'IMPORTED' || status === 'COMPLETED') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'FAILED' || status === 'COMPLETED_WITH_ERRORS') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'PROCESSING' || status === 'RUNNING') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'CANCELLED') return 'bg-gray-100 text-gray-600 border-gray-200';
  return 'bg-amber-50 text-amber-800 border-amber-200';
}

export const OpenMusicImporter: React.FC<OpenMusicImporterProps> = ({
  onImportComplete,
  onNavigateToCatalog,
}) => {
  const [query, setQuery] = useState('ambient');
  const [tracks, setTracks] = useState<JamendoTrack[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [adminKey, setAdminKey] = useState('');
  const [job, setJob] = useState<OpenMusicImportJob | null>(null);
  const [searching, setSearching] = useState(false);
  const [starting, setStarting] = useState(false);
  const [jobActionBusy, setJobActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failingTrackId, setFailingTrackId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lastJobStateRef = useRef<string>('');

  const searchTracks = useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (query.trim().length < 2) {
      setError('Enter at least two characters to search.');
      return;
    }
    setSearching(true);
    setError(null);
    setFailingTrackId(null);
    setNotice(null);
    try {
      const results = await searchOpenMusicTracks(query.trim(), 20);
      setTracks(results);
      setSelectedIds(new Set());
      if (results.length === 0) {
        setNotice('No downloadable CC BY or CC BY-SA tracks matched. Try another search term.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Music search failed.');
    } finally {
      setSearching(false);
    }
  }, [query]);

  useEffect(() => {
    void searchTracks();
    // Initial discovery only; later searches are explicit form submissions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After a page reload, entering the admin key resumes the latest queued/running job.
  useEffect(() => {
    if (!adminKey.trim() || job) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const activeJobs = await fetchActiveOpenMusicJobs(adminKey);
        if (!cancelled && activeJobs.length > 0) {
          setJob(activeJobs[0]);
          setNotice('Resumed an existing import job from the database.');
        }
      } catch {
        // An unfinished key should not disrupt searching; admin operations show the error on action.
      }
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [adminKey, job]);

  // Poll only while the job is active. Import state is persisted server-side in Neon.
  useEffect(() => {
    if (!job?.id || !adminKey.trim()) return;
    let stopped = false;
    let terminal = TERMINAL_STATES.has(job.status);
    const refresh = async () => {
      if (stopped || terminal) return;
      try {
        const next = await fetchOpenMusicImportJob(job.id, adminKey);
        if (stopped) return;
        setJob(next);
        terminal = TERMINAL_STATES.has(next.status);
      } catch (err: unknown) {
        if (!stopped) setError(err instanceof Error ? err.message : 'Unable to refresh import progress.');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [job?.id, job?.status, adminKey]);

  // Refresh Amber's catalog once whenever a job transitions into a terminal state.
  useEffect(() => {
    if (!job || !TERMINAL_STATES.has(job.status)) {
      if (job) lastJobStateRef.current = `${job.id}:${job.status}`;
      return;
    }
    const stateKey = `${job.id}:${job.status}`;
    if (lastJobStateRef.current !== stateKey) {
      lastJobStateRef.current = stateKey;
      onImportComplete();
    }
  }, [job, onImportComplete]);

  const selectedCount = selectedIds.size;
  const progress = useMemo(() => {
    if (!job || job.total === 0) return 0;
    return Math.min(100, Math.round(((job.imported + job.skipped + job.failed + job.cancelled) / job.total) * 100));
  }, [job]);

  const toggleTrack = (id: string) => {
    if (!selectedIds.has(id) && selectedIds.size >= 25) {
      setError('A batch can contain at most 25 tracks.');
      return;
    }
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeselectFailing = (id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    setFailingTrackId(null);
    setError(null);
  };

  const handleStartImport = async () => {
    if (!adminKey.trim()) {
      setError('Enter the Amber Admin API Key before starting an import.');
      return;
    }
    if (selectedIds.size === 0) {
      setError('Select at least one track.');
      return;
    }
    setStarting(true);
    setError(null);
    setFailingTrackId(null);
    setNotice(null);
    try {
      const newJob = await startOpenMusicImport(Array.from(selectedIds), adminKey);
      setJob(newJob);
      setSelectedIds(new Set());
      setNotice('Import queued. Amber downloads one track at a time and indexes it through the existing fingerprinting pipeline.');
    } catch (err: unknown) {
      if (err instanceof OpenMusicError) {
        setError(err.message);
        setFailingTrackId(err.trackId ?? null);
      } else if (err instanceof Error) {
        setError(err.message);
        const match = err.message.match(/Track\s+([0-9]{1,20})/);
        setFailingTrackId(match ? match[1] : null);
      } else {
        setError('Could not start import.');
        setFailingTrackId(null);
      }
    } finally {
      setStarting(false);
    }
  };

  const handleRetry = async () => {
    if (!job || !adminKey.trim()) return;
    setJobActionBusy(true);
    setError(null);
    try {
      setJob(await retryFailedOpenMusicImport(job.id, adminKey));
      setNotice('Failed tracks re-queued.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Retry failed.');
    } finally {
      setJobActionBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!job || !adminKey.trim()) return;
    setJobActionBusy(true);
    setError(null);
    try {
      setJob(await cancelOpenMusicImport(job.id, adminKey));
      setNotice('Pending tracks cancelled. A track already being indexed may finish first.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Cancellation failed.');
    } finally {
      setJobActionBusy(false);
    }
  };

  const activeJob = job && !TERMINAL_STATES.has(job.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <button onClick={onNavigateToCatalog} className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 mb-3">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to music library
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Open Music Importer</h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full">
              <Globe className="w-3 h-3" /> Jamendo
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Find openly licensed tracks, queue a batch, and let Amber fingerprint them. Audio is temporary; source, license, attribution, and content hash are retained.
          </p>
        </div>
        <a href="https://developer.jamendo.com/v3.0/tracks" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900">
          Source API <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)] gap-5 items-start">
        <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-gray-100">
            <form onSubmit={searchTracks} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} placeholder="Search genre, artist, or track..." className="w-full pl-9 pr-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <button type="submit" disabled={searching} className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 rounded-lg">
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Search
              </button>
            </form>
            <div className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-gray-500">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-600" />
              Only tracks that explicitly permit downloads and use CC BY or CC BY-SA licenses are shown. Metadata is re-verified by the backend at import time.
            </div>
          </div>

          <div className="divide-y divide-gray-100">
            {searching ? (
              <div className="py-16 flex flex-col items-center text-gray-500"><Loader2 className="w-7 h-7 animate-spin text-amber-600 mb-2" /><span className="text-sm">Searching Jamendo…</span></div>
            ) : tracks.length === 0 ? (
              <div className="py-14 px-6 text-center">
                <Music2 className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-700">No eligible tracks found</p>
                <p className="text-xs text-gray-500 mt-1">Try “jazz”, “ambient”, “classical”, “electronic”, or an artist name.</p>
              </div>
            ) : tracks.map((track) => {
              const selected = selectedIds.has(track.id);
              const isFailing = failingTrackId === track.id;
              return (
                <label key={track.id} className={`flex items-start gap-3 p-4 cursor-pointer transition-colors ${isFailing ? 'bg-red-50/70 border-l-4 border-red-500' : selected ? 'bg-amber-50/60' : 'hover:bg-gray-50'}`}>
                  <input type="checkbox" checked={selected} disabled={!selected && selectedCount >= 25} onChange={() => { toggleTrack(track.id); if (isFailing) setFailingTrackId(null); }} className="mt-1 h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-gray-900">{track.title}</span>
                      <span className="text-xs text-gray-400">{formatDuration(track.durationSeconds)}</span>
                      {isFailing && (
                        <span className="inline-flex items-center rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">
                          Ineligible track
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-600">{track.artist}{track.album ? ` · ${track.album}` : ''}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">{track.licenseName}</span>
                      <a href={track.licenseUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[10px] text-gray-500 hover:text-gray-800 hover:underline">License details</a>
                      <a href={track.sourceUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-800 hover:underline">Jamendo page <ExternalLink className="w-3 h-3" /></a>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-t border-gray-100 bg-gray-50/70">
            <span className="text-xs text-gray-500">{selectedCount} selected · Maximum 25 tracks per batch</span>
            <button onClick={handleStartImport} disabled={starting || selectedCount === 0} className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg shadow-sm">
              {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Queue selected tracks
            </button>
          </div>
        </section>

        <div className="space-y-5">
          <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-600" />
              <h2 className="text-sm font-semibold text-gray-900">Administrator access</h2>
            </div>
            <p className="text-xs leading-relaxed text-gray-500">The key stays in this page's memory and is sent only in the admin header. It is never saved to local storage or included in search requests.</p>
            <input type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)} autoComplete="current-password" placeholder="Amber Admin API Key" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
            <p className="text-[10px] text-gray-400">To resume a queued job after refreshing this page, enter the key again.</p>
          </section>

          <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-100">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Import queue</h2>
                <p className="text-[11px] text-gray-500 mt-0.5">Persisted in PostgreSQL</p>
              </div>
              {job && <span className={`inline-flex px-2 py-0.5 border rounded-full text-[10px] font-semibold ${statusTone(job.status)}`}>{job.status.replaceAll('_', ' ')}</span>}
            </div>
            {!job ? (
              <div className="p-6 text-center">
                <Download className="w-7 h-7 mx-auto text-gray-300 mb-2" />
                <p className="text-xs text-gray-500">Select tracks and queue an import to see per-track progress here.</p>
              </div>
            ) : (
              <div className="p-4 space-y-4">
                <div>
                  <div className="flex justify-between items-center text-xs mb-2"><span className="text-gray-600">Progress</span><span className="font-mono font-semibold text-gray-900">{progress}%</span></div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${progress}%` }} /></div>
                  <div className="grid grid-cols-4 gap-2 mt-3">
                    <div className="rounded-lg bg-emerald-50 p-2"><div className="text-lg font-semibold text-emerald-800">{job.imported}</div><div className="text-[10px] text-emerald-700">Imported</div></div>
                    <div className="rounded-lg bg-gray-50 p-2"><div className="text-lg font-semibold text-gray-700">{job.skipped}</div><div className="text-[10px] text-gray-500">Skipped</div></div>
                    <div className="rounded-lg bg-red-50 p-2"><div className="text-lg font-semibold text-red-700">{job.failed}</div><div className="text-[10px] text-red-600">Failed</div></div>
                    <div className="rounded-lg bg-amber-50 p-2"><div className="text-lg font-semibold text-amber-800">{job.queued + job.processing}</div><div className="text-[10px] text-amber-700">Remaining</div></div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {job.failed > 0 && <button onClick={handleRetry} disabled={jobActionBusy || !adminKey.trim()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"><RefreshCw className="w-3.5 h-3.5" /> Retry failed</button>}
                  {activeJob && <button onClick={handleCancel} disabled={jobActionBusy || !adminKey.trim()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"><XCircle className="w-3.5 h-3.5" /> Cancel pending</button>}
                  {TERMINAL_STATES.has(job.status) && <button onClick={() => setJob(null)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"><RefreshCw className="w-3.5 h-3.5" /> New job</button>}
                </div>
                <div className="max-h-[340px] overflow-y-auto divide-y divide-gray-100 border-t border-gray-100">
                  {job.items.map((item) => (
                    <div key={item.id} className="py-3 first:pt-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><p className="text-xs font-semibold text-gray-800 truncate">{item.title}</p><p className="text-[10px] text-gray-500 truncate">{item.artist}</p></div>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[9px] font-semibold ${statusTone(item.status)}`}>{item.status}</span>
                      </div>
                      {item.status === 'FAILED' && item.errorMessage && <p className="mt-1 text-[10px] leading-relaxed text-red-600">{item.errorMessage}</p>}
                      {item.status === 'IMPORTED' && <p className="mt-1 text-[10px] text-gray-400">Song ID {item.songId ?? '—'} · {humanBytes(item.downloadedBytes)}</p>}
                      {(item.status === 'IMPORTED' || item.status === 'SKIPPED') && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-1 text-[10px] text-gray-500 hover:underline">Source and attribution <ExternalLink className="w-3 h-3" /></a>}
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-gray-400 break-all">Job ID: {job.id}</div>
              </div>
            )}
          </section>
        </div>
      </div>

      {(error || notice) && <div role={error ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
        {error ? <XCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
        <div className="flex-1 flex flex-wrap items-center justify-between gap-2">
          <span>{error || notice}</span>
          {failingTrackId && selectedIds.has(failingTrackId) && (
            <button
              type="button"
              onClick={() => handleDeselectFailing(failingTrackId)}
              className="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded bg-red-100 text-red-800 hover:bg-red-200 border border-red-300 transition-colors"
            >
              Deselect track {failingTrackId}
            </button>
          )}
        </div>
        <button onClick={() => { setError(null); setNotice(null); setFailingTrackId(null); }} className="text-current opacity-70 hover:opacity-100" aria-label="Dismiss message">×</button>
      </div>}
    </div>
  );
};
