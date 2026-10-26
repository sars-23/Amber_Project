import React, { useState } from 'react';
import { Music, Trash2, Plus, Clock, Database, Loader2, AlertCircle } from 'lucide-react';
import { indexSong, deleteSong } from '../services/apiClient';
import type { Song } from '../types/api';

interface SongLibraryProps {
  songs: Song[];
  loading: boolean;
  onRefresh: () => void;
  onOpenBulkImport?: () => void;
}

export const SongLibrary: React.FC<SongLibraryProps> = ({ songs, loading, onRefresh, onOpenBulkImport }) => {
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [title, setTitle] = useState<string>('');
  const [artist, setArtist] = useState<string>('');
  const [uploading, setUploading] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const formatDuration = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !title.trim() || !artist.trim()) return;

    setUploading(true);
    setUploadError(null);
    try {
      await indexSong(uploadFile, title.trim(), artist.trim());
      setShowUploadModal(false);
      setUploadFile(null);
      setTitle('');
      setArtist('');
      onRefresh();
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Failed to index track');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: number, trackTitle: string) => {
    if (!window.confirm(`Are you sure you want to delete "${trackTitle}" and all its fingerprints?`)) {
      return;
    }
    setDeletingId(id);
    try {
      await deleteSong(id);
      onRefresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete track');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Music className="w-5 h-5 text-indigo-400" />
            Indexed Music Library
          </h2>
          <p className="text-xs text-slate-400">
            Catalog of reference recordings whose constellation fingerprints are indexed in PostgreSQL
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onOpenBulkImport && (
            <button
              onClick={onOpenBulkImport}
              className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-600/40 rounded-xl text-xs font-semibold transition-all shadow-sm"
              title="Launch Bulk Music Importer"
            >
              <Plus className="w-4 h-4 text-amber-400" />
              Bulk Import
            </button>
          )}

          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-all shadow-md shadow-indigo-950/40"
          >
            <Plus className="w-4 h-4" />
            Index Single Track
          </button>
        </div>
      </div>

      {/* Table of Songs */}
      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-2" />
          <span className="text-sm">Loading library index...</span>
        </div>
      ) : songs.length === 0 ? (
        <div className="py-12 text-center border border-dashed border-slate-800 rounded-xl">
          <Music className="w-10 h-10 text-slate-600 mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-slate-300">No tracks indexed yet</h3>
          <p className="text-xs text-slate-500 mt-1">
            Upload and index your first reference audio recording to start searching.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">Track & Artist</th>
                <th className="py-3 px-4">Duration</th>
                <th className="py-3 px-4">Fingerprints</th>
                <th className="py-3 px-4">Indexed On</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-sm">
              {songs.map((song) => (
                <tr key={song.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="font-semibold text-white">{song.title}</div>
                    <div className="text-xs text-slate-400">{song.artist}</div>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-slate-300 text-xs">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      {formatDuration(song.durationMs)}
                    </div>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-cyan-400 text-xs">
                    <div className="flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-slate-500" />
                      {song.fingerprintCount.toLocaleString()} hashes
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-xs text-slate-400">
                    {new Date(song.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={() => handleDelete(song.id, song.title)}
                      disabled={deletingId === song.id}
                      className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors rounded-lg hover:bg-rose-500/10"
                      title="Delete track"
                    >
                      {deletingId === song.id ? (
                        <Loader2 className="w-4 h-4 animate-spin text-rose-500" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload & Index Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-1">Index Audio Track</h3>
            <p className="text-xs text-slate-400 mb-4">
              Decode, extract spectral constellation peaks, and index into PostgreSQL
            </p>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Track Title
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Moonlight Sonata"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Artist / Source
                </label>
                <input
                  type="text"
                  required
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="e.g. Ludwig van Beethoven"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Audio File (WAV, MP3, FLAC)
                </label>
                <input
                  type="file"
                  required
                  accept="audio/*"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 cursor-pointer"
                />
              </div>

              {uploadError && (
                <div className="p-3 bg-rose-950/40 border border-rose-800/50 rounded-lg flex items-center gap-2 text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  disabled={uploading}
                  className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !uploadFile || !title || !artist}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2 shadow"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Normalizing & Indexing...
                    </>
                  ) : (
                    'Index Recording'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
