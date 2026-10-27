import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  FolderArchive,
  Upload,
  FolderUp,
  Play,
  Pause,
  RotateCcw,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowLeft,
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
  const [adminKey, setAdminKey] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [currentProcessingName, setCurrentProcessingName] = useState<string | null>(null);

  const cancelRequestedRef = useRef<boolean>(false);
  const pauseRequestedRef = useRef<boolean>(false);
  const runningRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  pauseRequestedRef.current = isPaused;
  runningRef.current = isRunning;

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

  useEffect(() => {
    setItems((prev) => checkDuplicates(prev, existingSongs));
  }, [existingSongs]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToQueue(Array.from(e.target.files));
      e.target.value = '';
    }
  };

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

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearCompleted = () => {
    setItems((prev) => prev.filter((item) => item.status !== 'indexed' && item.status !== 'skipped'));
  };

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

  const processItem = async (item: BulkImportItem, key: string): Promise<void> => {
    setCurrentProcessingName(item.filename);

    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: 'indexing' } : i))
    );

    try {
      const response = await indexSong(item.file, item.title.trim(), item.artist.trim(), key);

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

  const startImport = async () => {
    let effectiveKey = adminKey.trim();
    if (!effectiveKey) {
      const entered = window.prompt(
        'Administrator Authorization Required:\nEnter Admin API Key to import audio tracks into the database:'
      );
      if (entered === null) return;
      if (!entered.trim()) {
        alert('Admin API Key is required to import tracks.');
        return;
      }
      effectiveKey = entered.trim();
      setAdminKey(effectiveKey);
    }

    cancelRequestedRef.current = false;
    pauseRequestedRef.current = false;
    setIsRunning(true);
    setIsPaused(false);

    const queueCandidates = items.filter((item) => {
      if (item.status !== 'ready') return false;
      if (item.validationError) return false;
      if (skipDuplicates && item.isDuplicate) return false;
      return true;
    });

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

    const candidateIds = new Set(queueCandidates.map((i) => i.id));
    setItems((prev) =>
      prev.map((item) =>
        candidateIds.has(item.id) ? { ...item, status: 'queued' } : item
      )
    );

    const toProcess = [...queueCandidates];

    while (toProcess.length > 0) {
      if (cancelRequestedRef.current) break;

      while (pauseRequestedRef.current && !cancelRequestedRef.current) {
        await new Promise((r) => setTimeout(r, 400));
      }

      if (cancelRequestedRef.current) break;

      const batch = toProcess.splice(0, concurrency);
      await Promise.all(batch.map((item) => processItem(item, effectiveKey)));
    }

    setIsRunning(false);
    setIsPaused(false);
    setCurrentProcessingName(null);
    onImportComplete();
  };

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
      {/* Breadcrumb Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <button
            onClick={onNavigateToCatalog}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 mb-1 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Library Catalog</span>
          </button>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Bulk Music Importer
          </h1>
          <p className="text-sm text-gray-600 mt-0.5">
            Ingest multiple audio recordings or folders into Amber's acoustic database.
          </p>
        </div>

        <button
          onClick={onNavigateToCatalog}
          className="self-start sm:self-auto px-3.5 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm transition-colors"
        >
          View Library Catalog ({existingSongs.length})
        </button>
      </div>

      {/* Upload Zone Card */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a"
          className="hidden"
          onChange={handleFileInputChange}
        />
        <input
          ref={folderInputRef}
          type="file"
          {...{ webkitdirectory: '', directory: '' }}
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            isDragging
              ? 'border-amber-500 bg-amber-50/50'
              : 'border-gray-300 hover:border-gray-400 bg-gray-50/50'
          }`}
        >
          <div className="flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
              <FolderArchive className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                Drag and drop audio files or whole directories here
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Automatically extracts metadata from "Artist - Title.ext" conventions
              </p>
            </div>

            <div className="flex items-center gap-2.5 mt-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isRunning}
                className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm transition-colors"
              >
                <Upload className="w-3.5 h-3.5 text-amber-600" />
                Select Audio Files
              </button>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                disabled={isRunning}
                className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm transition-colors"
              >
                <FolderUp className="w-3.5 h-3.5 text-amber-600" />
                Select Folder
              </button>
            </div>
          </div>
        </div>

        {/* Queue Metrics Bar */}
        {totalCount > 0 && (
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-4 border-t border-gray-100 text-xs">
            <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-gray-500 block">Total Files</span>
              <span className="text-sm font-bold text-gray-900">{totalCount}</span>
            </div>
            <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-gray-500 block">Ready to Index</span>
              <span className="text-sm font-bold text-gray-900">{readyCount}</span>
            </div>
            <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-gray-500 block">Indexed</span>
              <span className="text-sm font-bold text-emerald-700">{indexedCount}</span>
            </div>
            <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-gray-500 block">Duplicates</span>
              <span className="text-sm font-bold text-amber-700">{duplicateCount}</span>
            </div>
            <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
              <span className="text-gray-500 block">Failed</span>
              <span className="text-sm font-bold text-red-600">{failedCount}</span>
            </div>
          </div>
        )}
      </div>

      {/* Active Progress Card */}
      {isRunning && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
              <span className="font-semibold text-gray-900">
                {isPaused ? 'Import Paused' : 'Processing Queue...'}
              </span>
              {currentProcessingName && (
                <span className="text-gray-500 truncate max-w-xs">
                  — {currentProcessingName}
                </span>
              )}
            </div>
            <span className="font-mono font-semibold text-gray-700">
              {completedCount} / {totalCount} ({progressPercent}%)
            </span>
          </div>

          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className="bg-amber-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Completion Banner */}
      {isFinished && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-emerald-900 shadow-sm">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold">Bulk Ingestion Completed</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                Successfully indexed {indexedCount} of {totalCount} recordings into PostgreSQL.
                {failedCount > 0 && ` (${failedCount} failed)`}
                {skippedCount > 0 && ` (${skippedCount} skipped)`}
              </p>
            </div>
          </div>
          <button
            onClick={onNavigateToCatalog}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-emerald-800 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-100 transition-colors self-start sm:self-auto"
          >
            <span>View in Catalog</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Queue Table Card */}
      {totalCount > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {/* Action Toolbar */}
          <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3 bg-gray-50/50">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                  disabled={isRunning}
                  className="rounded text-amber-600 focus:ring-amber-500"
                />
                <span>Auto-skip duplicates</span>
              </label>

              <div className="flex items-center gap-1.5 text-xs text-gray-600 pl-3 border-l border-gray-200">
                <span>Concurrency:</span>
                <select
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  disabled={isRunning}
                  className="text-xs font-medium bg-white border border-gray-300 rounded px-1.5 py-0.5"
                >
                  <option value={1}>1 (Sequential)</option>
                  <option value={2}>2 (Concurrent)</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-gray-600 pl-3 border-l border-gray-200">
                <span className="font-medium text-gray-700">Admin Key:</span>
                <input
                  type="password"
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  disabled={isRunning}
                  placeholder="AMBER_ADMIN_API_KEY"
                  className="text-xs px-2 py-0.5 border border-gray-300 rounded bg-white w-36 focus:ring-1 focus:ring-amber-500"
                  title="Server administrative key required for indexing tracks"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!isRunning ? (
                <button
                  onClick={startImport}
                  disabled={readyCount === 0}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:bg-gray-200 disabled:text-gray-400 rounded-lg shadow-sm transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Start Import ({readyCount})</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setIsPaused(!isPaused)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm"
                  >
                    {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                    <span>{isPaused ? 'Resume' : 'Pause'}</span>
                  </button>
                  <button
                    onClick={handleCancelPending}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Cancel</span>
                  </button>
                </>
              )}

              {failedCount > 0 && !isRunning && (
                <button
                  onClick={handleRetryFailed}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retry Failed ({failedCount})</span>
                </button>
              )}

              {!isRunning && (
                <button
                  onClick={handleClearCompleted}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100"
                >
                  Clear Completed
                </button>
              )}
            </div>
          </div>

          {/* Queue Table */}
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-gray-50/90 backdrop-blur-sm z-10">
                <tr className="border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">File Name</th>
                  <th className="py-2.5 px-3">Title (Editable)</th>
                  <th className="py-2.5 px-3">Artist (Editable)</th>
                  <th className="py-2.5 px-3">Size</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {item.status === 'ready' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-700">
                          Ready
                        </span>
                      )}
                      {item.status === 'queued' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-800">
                          Queued
                        </span>
                      )}
                      {item.status === 'indexing' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-900">
                          <Loader2 className="w-3 h-3 animate-spin text-amber-700" />
                          Indexing...
                        </span>
                      )}
                      {item.status === 'indexed' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-800">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          Done
                        </span>
                      )}
                      {item.status === 'skipped' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-500">
                          Skipped
                        </span>
                      )}
                      {item.status === 'failed' && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-50 text-red-700 cursor-help"
                          title={item.errorDetails || item.validationError || 'Failed'}
                        >
                          <XCircle className="w-3 h-3 text-red-500" />
                          Failed
                        </span>
                      )}
                      {item.isDuplicate && (
                        <span
                          className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200 cursor-help"
                          title={item.duplicateInfo || 'Duplicate track detected'}
                        >
                          Duplicate
                        </span>
                      )}
                    </td>

                    <td className="py-2.5 px-3 max-w-[160px] truncate font-medium text-gray-900" title={item.filename}>
                      {item.filename}
                    </td>

                    <td className="py-2.5 px-3">
                      <input
                        type="text"
                        value={item.title}
                        disabled={isRunning || item.status === 'indexed'}
                        onChange={(e) => updateItemMetadata(item.id, 'title', e.target.value)}
                        className="w-full px-2 py-1 text-xs text-gray-900 bg-transparent hover:bg-gray-100/70 focus:bg-white border border-transparent hover:border-gray-300 focus:border-amber-500 rounded focus:outline-none"
                      />
                    </td>

                    <td className="py-2.5 px-3">
                      <input
                        type="text"
                        value={item.artist}
                        disabled={isRunning || item.status === 'indexed'}
                        onChange={(e) => updateItemMetadata(item.id, 'artist', e.target.value)}
                        className="w-full px-2 py-1 text-xs text-gray-900 bg-transparent hover:bg-gray-100/70 focus:bg-white border border-transparent hover:border-gray-300 focus:border-amber-500 rounded focus:outline-none"
                      />
                    </td>

                    <td className="py-2.5 px-3 whitespace-nowrap font-mono text-gray-500 text-[11px]">
                      {formatFileSize(item.size)}
                    </td>

                    <td className="py-2.5 px-3 text-right">
                      {!isRunning && item.status !== 'indexing' && (
                        <button
                          onClick={() => removeItem(item.id)}
                          className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors"
                          title="Remove item from queue"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
