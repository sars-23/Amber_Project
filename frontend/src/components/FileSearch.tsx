import React, { useState, useRef } from 'react';
import { UploadCloud, Music, Search, Loader2, AlertCircle } from 'lucide-react';
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
      setResult(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setError(null);
      setResult(null);
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

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Search className="w-5 h-5 text-cyan-400" />
            Audio File Identification
          </h2>
          <p className="text-xs text-slate-400">
            Upload a short excerpt (WAV, MP3, etc.) to query the acoustic constellation index
          </p>
        </div>
      </div>

      {/* Drag & Drop Area */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          file
            ? 'border-cyan-500/50 bg-cyan-950/10'
            : 'border-slate-700 hover:border-slate-600 bg-slate-950/40'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleFileChange}
        />

        <div className="flex flex-col items-center justify-center gap-2">
          {file ? (
            <div className="p-3 bg-cyan-500/20 text-cyan-400 rounded-full">
              <Music className="w-8 h-8" />
            </div>
          ) : (
            <div className="p-3 bg-slate-800 text-slate-400 rounded-full">
              <UploadCloud className="w-8 h-8" />
            </div>
          )}

          {file ? (
            <div>
              <div className="text-sm font-semibold text-white">{file.name}</div>
              <div className="text-xs text-slate-400">
                {(file.size / 1024).toFixed(1)} KB — Click or drop another to replace
              </div>
            </div>
          ) : (
            <div>
              <div className="text-sm font-semibold text-slate-300">
                Click to browse or drop an audio file
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Supports WAV, MP3, OGG, FLAC (1 to 30 second excerpt recommended)
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search trigger */}
      <div className="mt-4 flex items-center justify-end">
        <button
          onClick={handleSearch}
          disabled={!file || loading}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg ${
            !file || loading
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white shadow-cyan-900/30'
          }`}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-cyan-300" />
              Fingerprinting & Matching...
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              Identify Audio
            </>
          )}
        </button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mt-4 p-4 bg-rose-950/40 border border-rose-800/50 rounded-xl flex items-center gap-3 text-rose-300 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Result Card */}
      {result && <MatchResultCard result={result} />}
    </div>
  );
};
