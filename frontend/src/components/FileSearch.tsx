import React, { useState, useRef } from 'react';
import { UploadCloud, Search, Loader2, AlertCircle, X, FileAudio } from 'lucide-react';
import { searchAudio } from '../services/apiClient';
import { MatchResultCard } from './MatchResultCard';
import type { MatchResponse } from '../types/api';

interface FileSearchProps {
  onSearchComplete?: (result: MatchResponse) => void;
}

export const FileSearch: React.FC<FileSearchProps> = ({ onSearchComplete }) => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      selectFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      selectFile(e.dataTransfer.files[0]);
    }
  };

  const selectFile = (selected: File) => {
    // Validate size (25MB max)
    if (selected.size > 25 * 1024 * 1024) {
      setError('File size exceeds the 25 MB maximum limit.');
      return;
    }
    setFile(selected);
    setError(null);
    setResult(null);
  };

  const handleClear = () => {
    setFile(null);
    setError(null);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSearch = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const match = await searchAudio(file);
      setResult(match);
      if (onSearchComplete) onSearchComplete(match);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Audio identification failed');
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Title & Introduction */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Identify Audio
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Upload an audio excerpt to search against Amber's indexed catalog using acoustic constellation matching.
        </p>
      </div>

      {/* Main Upload Card */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a"
          className="hidden"
          onChange={handleFileChange}
        />

        {!file ? (
          /* Dropzone */
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-amber-500 bg-amber-50/50'
                : 'border-gray-300 hover:border-gray-400 bg-gray-50/60 hover:bg-gray-50'
            }`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                fileInputRef.current?.click();
              }
            }}
          >
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="w-12 h-12 rounded-full bg-amber-100/70 text-amber-700 flex items-center justify-center">
                <UploadCloud className="w-6 h-6" />
              </div>
              <div>
                <span className="text-sm font-semibold text-gray-900 hover:text-amber-700">
                  Click to browse
                </span>
                <span className="text-sm text-gray-500"> or drag and drop an audio file</span>
              </div>
              <p className="text-xs text-gray-500 max-w-sm">
                Supported formats: WAV, MP3, FLAC, OGG, M4A (up to 25 MB)
              </p>
            </div>
          </div>
        ) : (
          /* File Selected Workspace */
          <div className="space-y-5">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center flex-shrink-0">
                  <FileAudio className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">
                    {file.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatFileSize(file.size)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-200/60 rounded-md transition-colors"
                >
                  Change file
                </button>
                <button
                  onClick={handleClear}
                  disabled={loading}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200/60 rounded-md transition-colors"
                  title="Remove file"
                  aria-label="Remove file"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={handleSearch}
                disabled={loading}
                className="flex items-center gap-2 px-6 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-medium text-sm rounded-lg transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Analyzing audio constellation...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    <span>Identify Audio</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-700 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-500 mt-0.5" />
            <div>
              <p className="font-medium">Audio Identification Failed</p>
              <p className="text-xs text-red-600 mt-0.5">{error}</p>
            </div>
          </div>
        )}
      </div>

      {/* Match Result Display */}
      {result && <MatchResultCard result={result} />}
    </div>
  );
};
