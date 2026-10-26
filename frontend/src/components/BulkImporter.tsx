import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  FolderArchive,
  Upload,
  FolderUp,
  FileAudio,
  Play,
  Pause,
  RotateCcw,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  FileWarning,
  Sparkles,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { indexSong } from '../services/apiClient';
import type { Song } from '../types/api';
import {
  type BulkImportItem,
  parseMetadataFromFilename,
  validateAudioFile,
  validateMetadata,
  formatFileSize,
  checkDuplicates,
} from '../utils/bulkImportHelpers';

interface BulkImporterProps {
  existingSongs: Song[];
  onImportComplete: () => void;
  onNavigateToCatalog: () => void;
}

export const BulkImporter: React.FC<BulkImporterProps> = ({
  existingSongs,
  onImportComplete,
  onNavigateToCatalog,
}) => {
  const [items, setItems] = useState<BulkImportItem[]>([]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [skipDuplicates, setSkipDuplicates] = useState<boolean>(true);
  const [concurrency, setConcurrency] = useState<number>(1);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [currentProcessingName, setCurrentProcessingName] = useState<string | null>(null);

  // Cancellation and pause refs for clean asynchronous loop control
  const cancelRequestedRef = useRef<boolean>(false);
  const pauseRequestedRef = useRef<boolean>(false);
  const runningRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // Sync refs with state
  pauseRequestedRef.current = isPaused;
  runningRef.current = isRunning;

  // Add files to queue with parsing, validation, and duplicate detection
  const addFilesToQueue = useCallback(
    (files: File[]) => {
      if (!files || files.length === 0) return;

      setItems((prevItems) => {
        const newItems: BulkImportItem[] = [];

        for (const file of files) {
          const validation = validateAudioFile(file);
          const parsed = parseMetadataFromFilename(file.name);

          const item: BulkImportItem = {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            file,
            filename: file.name,
            title: parsed.title,
            artist: parsed.artist,
            size: file.size,
            status: validation.isValid ? 'ready' : 'failed',
            validationError: validation.isValid ? null : validation.error,
            errorDetails: validation.isValid ? null : validation.error,
            isDuplicate: false,
          };
          newItems.push(item);
        }

        const combined = [...prevItems, ...newItems];
        return checkDuplicates(combined, existingSongs);
      });
    },
    [existingSongs]
  );

  // Update duplicate statuses whenever existing songs catalog changes
  useEffect(() => {
    setItems((prev) => checkDuplicates(prev, existingSongs));
  }, [existingSongs]);

  // Handle single and multiple file inputs
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToQueue(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  // Drag and drop events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles: File[] = [];

    // Support folder drag-and-drop traversal if webkitGetAsEntry is available
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      const itemsList = Array.from(e.dataTransfer.items);
      const queue: FileSystemEntry[] = [];

      for (const item of itemsList) {
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry?.();
          if (entry) {
            queue.push(entry);
          } else {
            const f = item.getAsFile();
            if (f) droppedFiles.push(f);
          }
        }
      }

      // Traverse directory tree recursively
      while (queue.length > 0) {
        const entry = queue.shift()!;
        if (entry.isFile) {
          const fileEntry = entry as FileSystemFileEntry;
          await new Promise<void>((resolve) => {
            fileEntry.file(
              (f) => {
                droppedFiles.push(f);
                resolve();
              },
              () => resolve()
            );
          });
        } else if (entry.isDirectory) {
          const dirEntry = entry as FileSystemDirectoryEntry;
          const reader = dirEntry.createReader();
          await new Promise<void>((resolve) => {
            reader.readEntries(
              (entries) => {
                queue.push(...entries);
                resolve();
              },
              () => resolve()
            );
          });
        }
      }
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      droppedFiles.push(...Array.from(e.dataTransfer.files));
    }

    if (droppedFiles.length > 0) {
      addFilesToQueue(droppedFiles);
    }
  };

  // Metadata field updates in queue
  const updateItemMetadata = (
    id: string,
    field: 'title' | 'artist',
    value: string
  ) => {
    setItems((prev) => {
      const updated = prev.map((item) => {
        if (item.id === id) {
          const newItem = { ...item, [field]: value };
          const metaError = validateMetadata(
            field === 'title' ? value : newItem.title,
            field === 'artist' ? value : newItem.artist
          );
          return {
            ...newItem,
            validationError: metaError,
          };
        }
        return item;
      });
      return checkDuplicates(updated, existingSongs);
    });
  };

  // Remove individual item
  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Toggle item skip state
  const toggleSkipItem = (id: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          if (item.status === 'skipped') {
            return { ...item, status: 'ready', errorDetails: null };
          } else if (item.status === 'ready' || item.status === 'failed') {
            return { ...item, status: 'skipped', errorDetails: 'Skipped by user' };
          }
        }
        return item;
      })
    );
  };

  // Clear completed and skipped
  const handleClearCompleted = () => {
    setItems((prev) => prev.filter((item) => item.status !== 'indexed' && item.status !== 'skipped'));
  };

  // Retry failed items
  const handleRetryFailed = () => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.status === 'failed') {
          const val = validateAudioFile(item.file);
          const meta = validateMetadata(item.title, item.artist);
          const err = val.error || meta;
          return {
            ...item,
            status: err ? 'failed' : 'ready',
            validationError: err,
            errorDetails: err,
          };
        }
        return item;
      })
    );
  };

  // Cancel remaining pending items
  const handleCancelPending = () => {
    cancelRequestedRef.current = true;
    setIsRunning(false);
    setIsPaused(false);
    setCurrentProcessingName(null);

    setItems((prev) =>
      prev.map((item) => {
        if (item.status === 'queued') {
          return { ...item, status: 'ready' };
        }
        return item;
      })
    );
  };

  // Process a single item
  const processItem = async (item: BulkImportItem): Promise<void> => {
    setCurrentProcessingName(item.filename);

    // Update status to indexing
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: 'indexing' } : i))
    );

    try {
      const response = await indexSong(item.file, item.title.trim(), item.artist.trim());

      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                status: 'indexed',
                fingerprintCount: response.fingerprintCount,
                durationMs: response.durationMs,
                errorDetails: null,
              }
            : i
        )
      );

      // Trigger catalog refresh in background so stats/counts update progressively
      onImportComplete();
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : 'Unknown audio indexing error';

      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                status: 'failed',
                errorDetails: errorMsg,
              }
            : i
        )
      );
    }
  };

  // Main Queue Processor Loop
  const startImport = async () => {
    cancelRequestedRef.current = false;
    pauseRequestedRef.current = false;
    setIsRunning(true);
    setIsPaused(false);

    // Determine which items to queue
    const queueCandidates = items.filter((item) => {
      if (item.status !== 'ready') return false;
      if (item.validationError) return false;
      if (skipDuplicates && item.isDuplicate) return false;
      return true;
    });

    // Mark skipped duplicate items
    if (skipDuplicates) {
      setItems((prev) =>
        prev.map((item) => {
          if (item.status === 'ready' && item.isDuplicate) {
            return {
              ...item,
              status: 'skipped',
              errorDetails: item.duplicateInfo || 'Skipped duplicate',
            };
          }
          return item;
        })
      );
    }

    // Mark candidates as queued
    const candidateIds = new Set(queueCandidates.map((i) => i.id));
    setItems((prev) =>
      prev.map((item) =>
        candidateIds.has(item.id) ? { ...item, status: 'queued' } : item
      )
    );

    // Process sequentially or bounded concurrency
    const toProcess = [...queueCandidates];

    while (toProcess.length > 0) {
      if (cancelRequestedRef.current) break;

      // Handle pause loop
      while (pauseRequestedRef.current && !cancelRequestedRef.current) {
        await new Promise((r) => setTimeout(r, 400));
      }

      if (cancelRequestedRef.current) break;

      const batch = toProcess.splice(0, concurrency);
      await Promise.all(batch.map((item) => processItem(item)));
    }

    setIsRunning(false);
    setIsPaused(false);
    setCurrentProcessingName(null);
    onImportComplete();
  };

  // Counts & stats
  const totalCount = items.length;
  const readyCount = items.filter((i) => i.status === 'ready' && !i.validationError).length;
  const indexedCount = items.filter((i) => i.status === 'indexed').length;
  const failedCount = items.filter((i) => i.status === 'failed').length;
  const skippedCount = items.filter((i) => i.status === 'skipped').length;
  const duplicateCount = items.filter((i) => i.isDuplicate).length;
  const completedCount = indexedCount + failedCount + skippedCount;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const isFinished = totalCount > 0 && completedCount === totalCount && !isRunning;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <FolderArchive className="w-5 h-5 text-amber-400" />
              Bulk Music Importer
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              High-throughput batch ingestion into PostgreSQL with duplicate detection, metadata editing, and queue controls
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isRunning}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-all border border-slate-700/60 shadow-sm disabled:opacity-50"
            >
              <FileAudio className="w-4 h-4 text-cyan-400" />
              Select Files
            </button>

            <button
              onClick={() => folderInputRef.current?.click()}
              disabled={isRunning}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-all border border-slate-700/60 shadow-sm disabled:opacity-50"
              title="Upload entire folder recursively using webkitdirectory"
            >
              <FolderUp className="w-4 h-4 text-amber-400" />
              Select Folder
            </button>

            {/* Hidden file & directory inputs */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.aiff,.wma"
              onChange={handleFileInputChange}
              className="hidden"
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
              onChange={handleFileInputChange}
              className="hidden"
            />
          </div>
        </div>

        {/* Dropzone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`mt-6 border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
            isDragging
              ? 'border-amber-400 bg-amber-950/20 shadow-lg shadow-amber-900/20'
              : 'border-slate-800 hover:border-slate-700 bg-slate-950/40'
          }`}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="flex flex-col items-center justify-center">
            <div className="p-3 bg-amber-500/10 rounded-2xl mb-3 text-amber-400 border border-amber-500/20">
              <Upload className="w-6 h-6 animate-bounce" />
            </div>
            <div className="text-sm font-semibold text-slate-200">
              Drag & Drop audio files or entire folders here
            </div>
            <div className="text-xs text-slate-400 mt-1 max-w-md">
              Supports <span className="text-amber-300 font-mono">WAV, MP3, FLAC, OGG, M4A, AAC, AIFF, WMA</span> up to 25 MB each.
              Folder imports recursively inspect supported audio files.
            </div>
          </div>
        </div>
      </div>

      {/* Summary Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-3.5 backdrop-blur-sm">
          <div className="text-[11px] text-slate-400 uppercase font-semibold">Total Selected</div>
          <div className="text-xl font-bold text-white mt-1 font-mono">{totalCount}</div>
        </div>

        <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-3.5 backdrop-blur-sm">
          <div className="text-[11px] text-emerald-400 uppercase font-semibold">Ready to Import</div>
          <div className="text-xl font-bold text-emerald-400 mt-1 font-mono">{readyCount}</div>
        </div>

        <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-3.5 backdrop-blur-sm">
          <div className="text-[11px] text-amber-400 uppercase font-semibold">Duplicate Candidates</div>
          <div className="text-xl font-bold text-amber-400 mt-1 font-mono">{duplicateCount}</div>
        </div>

        <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-3.5 backdrop-blur-sm">
          <div className="text-[11px] text-cyan-400 uppercase font-semibold">Successfully Indexed</div>
          <div className="text-xl font-bold text-cyan-400 mt-1 font-mono">{indexedCount}</div>
        </div>

        <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-3.5 backdrop-blur-sm">
          <div className="text-[11px] text-rose-400 uppercase font-semibold">Failed / Skipped</div>
          <div className="text-xl font-bold text-rose-400 mt-1 font-mono">
            {failedCount} <span className="text-xs text-slate-500">/ {skippedCount}</span>
          </div>
        </div>
      </div>

      {/* Queue Controls & Progress */}
      {totalCount > 0 && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Control Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              {!isRunning ? (
                <button
                  onClick={startImport}
                  disabled={readyCount === 0}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-indigo-600 hover:from-amber-400 hover:to-indigo-500 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-lg shadow-amber-950/40 disabled:opacity-50"
                >
                  <Play className="w-4 h-4 fill-slate-950" />
                  Start Bulk Import ({readyCount})
                </button>
              ) : isPaused ? (
                <button
                  onClick={() => setIsPaused(false)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-all shadow-lg"
                >
                  <Play className="w-4 h-4" />
                  Resume Import
                </button>
              ) : (
                <button
                  onClick={() => setIsPaused(true)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl text-xs transition-all shadow-lg"
                >
                  <Pause className="w-4 h-4" />
                  Pause Import
                </button>
              )}

              {isRunning && (
                <button
                  onClick={handleCancelPending}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 bg-rose-950/60 hover:bg-rose-900/60 text-rose-200 border border-rose-800/60 rounded-xl text-xs font-semibold transition-all"
                >
                  <XCircle className="w-4 h-4" />
                  Cancel Pending
                </button>
              )}

              {failedCount > 0 && !isRunning && (
                <button
                  onClick={handleRetryFailed}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 bg-indigo-950/60 hover:bg-indigo-900/60 text-indigo-200 border border-indigo-800/60 rounded-xl text-xs font-semibold transition-all"
                >
                  <RotateCcw className="w-4 h-4" />
                  Retry Failed ({failedCount})
                </button>
              )}

              {(indexedCount > 0 || skippedCount > 0) && !isRunning && (
                <button
                  onClick={handleClearCompleted}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear Completed
                </button>
              )}
            </div>

            {/* Options: Duplicates & Concurrency */}
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  disabled={isRunning}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                  className="w-4 h-4 rounded text-amber-500 bg-slate-800 border-slate-700 focus:ring-0"
                />
                <span>Auto-skip detected duplicates</span>
              </label>

              <div className="flex items-center gap-2">
                <span className="text-slate-400">Concurrency:</span>
                <select
                  value={concurrency}
                  disabled={isRunning}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none"
                >
                  <option value={1}>1 (Sequential - Safe Free Tier)</option>
                  <option value={2}>2 (Concurrent)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Large batch compute warning */}
          {totalCount > 20 && (
            <div className="p-3 bg-amber-950/30 border border-amber-800/40 rounded-xl flex items-center gap-2.5 text-amber-300 text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>
                Batch contains <strong>{totalCount} tracks</strong>. Indexing performs Cooley-Tukey FFTs and constellation peak extraction sequentially. Please keep this tab open during execution.
              </span>
            </div>
          )}

          {/* Progress Bar */}
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5 font-mono">
              <span>
                {isRunning ? (
                  <span className="text-amber-400 flex items-center gap-1.5 font-semibold">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {currentProcessingName ? `Indexing: ${currentProcessingName}` : 'Processing queue...'}
                  </span>
                ) : isFinished ? (
                  <span className="text-emerald-400 flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    All items finished!
                  </span>
                ) : (
                  'Import Queue Status'
                )}
              </span>
              <span>
                {completedCount} / {totalCount} ({progressPercent}%)
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-amber-500 via-indigo-500 to-cyan-400 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Completion Summary Card */}
      {isFinished && (
        <div className="p-4 bg-gradient-to-r from-emerald-950/40 to-slate-900 border border-emerald-800/50 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">Import Batch Completed</div>
              <div className="text-xs text-slate-400">
                Indexed <span className="text-emerald-400 font-bold">{indexedCount} tracks</span>,{' '}
                <span className="text-rose-400 font-bold">{failedCount} failed</span>,{' '}
                <span className="text-slate-300 font-bold">{skippedCount} skipped</span>.
              </div>
            </div>
          </div>

          <button
            onClick={onNavigateToCatalog}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-all shadow"
          >
            <span>View Catalog Library</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Import Items Table */}
      {totalCount > 0 ? (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl shadow-xl overflow-hidden backdrop-blur-md">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              Import Queue ({items.length} items)
            </h3>
            <span className="text-xs text-slate-500 font-mono">
              Editable metadata — click titles/artists to adjust
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider bg-slate-950/40">
                  <th className="py-3 px-4">#</th>
                  <th className="py-3 px-4">File</th>
                  <th className="py-3 px-4">Title</th>
                  <th className="py-3 px-4">Artist</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Status / Details</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs font-sans">
                {items.map((item, idx) => (
                  <tr
                    key={item.id}
                    className={`hover:bg-slate-800/30 transition-colors ${
                      item.status === 'indexing'
                        ? 'bg-amber-500/5'
                        : item.status === 'failed'
                        ? 'bg-rose-950/10'
                        : item.isDuplicate
                        ? 'bg-amber-950/10'
                        : ''
                    }`}
                  >
                    <td className="py-3 px-4 text-slate-500 font-mono">{idx + 1}</td>

                    {/* Original Filename */}
                    <td className="py-3 px-4 font-mono text-slate-300 max-w-xs truncate" title={item.filename}>
                      <div className="flex items-center gap-1.5">
                        <FileAudio className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                        <span className="truncate">{item.filename}</span>
                      </div>
                    </td>

                    {/* Editable Title */}
                    <td className="py-3 px-4 min-w-[180px]">
                      <input
                        type="text"
                        disabled={item.status === 'indexing' || item.status === 'indexed'}
                        value={item.title}
                        onChange={(e) => updateItemMetadata(item.id, 'title', e.target.value)}
                        className={`w-full bg-slate-950/80 border rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-600 focus:outline-none transition-colors ${
                          !item.title.trim()
                            ? 'border-rose-500 focus:border-rose-400'
                            : 'border-slate-800 focus:border-amber-500'
                        }`}
                        placeholder="Song Title"
                      />
                    </td>

                    {/* Editable Artist */}
                    <td className="py-3 px-4 min-w-[180px]">
                      <input
                        type="text"
                        disabled={item.status === 'indexing' || item.status === 'indexed'}
                        value={item.artist}
                        onChange={(e) => updateItemMetadata(item.id, 'artist', e.target.value)}
                        className={`w-full bg-slate-950/80 border rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-600 focus:outline-none transition-colors ${
                          !item.artist.trim()
                            ? 'border-rose-500 focus:border-rose-400'
                            : 'border-slate-800 focus:border-amber-500'
                        }`}
                        placeholder="Artist Name"
                      />
                    </td>

                    {/* File Size */}
                    <td className="py-3 px-4 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                      {formatFileSize(item.size)}
                    </td>

                    {/* Status & Diagnostic Details */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      {item.status === 'ready' && (
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 w-fit">
                            Ready
                          </span>
                          {item.isDuplicate && (
                            <span className="text-[10px] text-amber-400 flex items-center gap-1" title={item.duplicateInfo}>
                              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                              Duplicate candidate
                            </span>
                          )}
                        </div>
                      )}

                      {item.status === 'queued' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-800/50">
                          Queued
                        </span>
                      )}

                      {item.status === 'indexing' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-950 text-amber-300 border border-amber-800/60 animate-pulse">
                          <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                          Indexing...
                        </span>
                      )}

                      {item.status === 'indexed' && (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800/60 w-fit">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            Indexed
                          </span>
                          <span className="text-[10px] font-mono text-cyan-400">
                            {item.fingerprintCount?.toLocaleString() || 0} fingerprints
                          </span>
                        </div>
                      )}

                      {item.status === 'failed' && (
                        <div className="flex flex-col gap-0.5 max-w-xs">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-950 text-rose-300 border border-rose-800/60 w-fit">
                            <FileWarning className="w-3 h-3 text-rose-400" />
                            Failed
                          </span>
                          <span className="text-[10px] text-rose-400 truncate" title={item.errorDetails || 'Validation failed'}>
                            {item.errorDetails || 'Validation failed'}
                          </span>
                        </div>
                      )}

                      {item.status === 'skipped' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400" title={item.errorDetails || 'Skipped'}>
                          Skipped
                        </span>
                      )}
                    </td>

                    {/* Row Actions */}
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {item.status !== 'indexing' && item.status !== 'indexed' && (
                          <button
                            onClick={() => toggleSkipItem(item.id)}
                            className="px-2 py-1 text-[11px] rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                            title={item.status === 'skipped' ? 'Mark Ready' : 'Skip track'}
                          >
                            {item.status === 'skipped' ? 'Include' : 'Skip'}
                          </button>
                        )}

                        <button
                          onClick={() => removeItem(item.id)}
                          disabled={item.status === 'indexing'}
                          className="p-1 text-slate-500 hover:text-rose-400 transition-colors rounded hover:bg-rose-500/10 disabled:opacity-30"
                          title="Remove from queue"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="py-12 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-900/40">
          <Sparkles className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-slate-300">Import Queue is Empty</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Drag audio files or folders above, or click <strong>Select Files</strong> to stage tracks for bulk fingerprinting.
          </p>
        </div>
      )}
    </div>
  );
};
