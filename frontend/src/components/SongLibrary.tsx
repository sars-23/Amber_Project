import React, { useState, useMemo } from 'react';
import { Music, Trash2, Plus, Clock, Database, Loader2, AlertCircle, Search, FolderUp, X } from 'lucide-react';
import { indexSong, deleteSong } from '../services/apiClient';
import type { Song } from '../types/api';

interface SongLibraryProps {
  songs: Song[];
  loading: boolean;
  onRefresh: () => void;
  onOpenBulkImport?: () => void;
}

export const SongLibrary: React.FC<SongLibraryProps> = ({
  songs,
  loading,
  onRefresh,
  onOpenBulkImport,
}) => {
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [title, setTitle] = useState<string>('');
  const [artist, setArtist] = useState<string>('');
  const [uploading, setUploading] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const formatDuration = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const filteredSongs = useMemo(() => {
    if (!searchQuery.trim()) return songs;
    const q = searchQuery.toLowerCase();
    return songs.filter(
      (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
    );
  }, [songs, searchQuery]);

  const totalFingerprints = useMemo(() => {
    return songs.reduce((sum, s) => sum + (s.fingerprintCount || 0), 0);
  }, [songs]);

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
    if (!window.confirm(`Delete "${trackTitle}" and remove its constellation fingerprints from the database?`)) {
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
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Music Library
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Reference audio tracks indexed in PostgreSQL for acoustic constellation matching.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {onOpenBulkImport && (
            <button
              onClick={onOpenBulkImport}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
              title="Batch import multiple audio files or entire folder"
            >
              <FolderUp className="w-4 h-4 text-amber-600" />
              <span>Bulk Import</span>
            </button>
          )}

          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Index Single Track</span>
          </button>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {/* Table Toolbar & Stats */}
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50/50">
          <div className="relative max-w-xs w-full">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title or artist..."
              className="w-full pl-9 pr-3 py-1.5 text-xs text-gray-900 bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            />
          </div>

          <div className="text-xs text-gray-500 font-medium">
            {songs.length} {songs.length === 1 ? 'track' : 'tracks'} indexed • {totalFingerprints.toLocaleString()} total hashes
          </div>
        </div>

        {/* Content Area */}
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin text-amber-600 mb-2" />
            <span className="text-sm font-medium">Loading catalog index...</span>
          </div>
        ) : songs.length === 0 ? (
          /* Empty State */
          <div className="py-16 px-6 text-center max-w-md mx-auto">
            <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-3">
              <Music className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-gray-900">
              No Reference Tracks Indexed
            </h3>
            <p className="text-xs text-gray-500 mt-1.5 mb-6">
              Amber identifies audio clips by matching them against indexed reference recordings. Upload a track or folder to build your library.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setShowUploadModal(true)}
                className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm transition-colors"
              >
                Index Single Track
              </button>
              {onOpenBulkImport && (
                <button
                  onClick={onOpenBulkImport}
                  className="px-4 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg shadow-sm transition-colors"
                >
                  Bulk Import Folder
                </button>
              )}
            </div>
          </div>
        ) : filteredSongs.length === 0 ? (
          /* Filtered empty */
          <div className="py-12 text-center text-gray-500">
            <p className="text-sm">No tracks matched "{searchQuery}"</p>
            <button
              onClick={() => setSearchQuery('')}
              className="mt-2 text-xs text-amber-600 hover:underline font-medium"
            >
              Clear search filter
            </button>
          </div>
        ) : (
          /* Populated Table */
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/75 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Track Title</th>
                  <th className="py-3 px-4">Artist</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Fingerprints</th>
                  <th className="py-3 px-4">Date Indexed</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {filteredSongs.map((song) => (
                  <tr key={song.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="py-3 px-4 font-semibold text-gray-900">
                      {song.title}
                    </td>
                    <td className="py-3 px-4 text-gray-600 text-xs">
                      {song.artist}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-gray-600">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        <span>{formatDuration(song.durationMs)}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-gray-600">
                      <div className="flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5 text-gray-400" />
                        <span>{song.fingerprintCount.toLocaleString()} hashes</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-500">
                      {new Date(song.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleDelete(song.id, song.title)}
                        disabled={deletingId === song.id}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Delete track"
                        aria-label={`Delete ${song.title}`}
                      >
                        {deletingId === song.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-red-600" />
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
      </div>

      {/* Index Single Track Modal */}
      {showUploadModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in"
          onClick={() => setShowUploadModal(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="index-track-modal-title"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 id="index-track-modal-title" className="text-base font-semibold text-gray-900">
                Index Single Audio Track
              </h2>
              <button
                onClick={() => setShowUploadModal(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Track Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Moonlight Sonata"
                  className="w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Artist / Source <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="e.g. Ludwig van Beethoven"
                  className="w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Audio File (WAV, MP3, FLAC) <span className="text-red-500">*</span>
                </label>
                <input
                  type="file"
                  required
                  accept="audio/*,.wav,.mp3,.flac,.ogg"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 cursor-pointer"
                />
              </div>

              {uploadError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-xs text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" />
                  <span>{uploadError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  disabled={uploading}
                  className="px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !uploadFile || !title.trim() || !artist.trim()}
                  className="px-5 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:bg-gray-200 disabled:text-gray-400 rounded-lg transition-colors flex items-center gap-2 shadow-sm"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Fingerprinting & Indexing...</span>
                    </>
                  ) : (
                    <span>Index Track</span>
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
