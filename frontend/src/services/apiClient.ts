import type { Song, MatchResponse, StatsResponse, HealthResponse } from '../types/api';

const API_BASE = '/api/v1';

export async function fetchStats(): Promise<StatsResponse> {
  const res = await fetch(`${API_BASE}/stats`);
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.statusText}`);
  return res.json();
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.statusText}`);
  return res.json();
}

export async function fetchSongs(limit: number = 50, offset: number = 0): Promise<Song[]> {
  const res = await fetch(`${API_BASE}/songs?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error(`Failed to fetch songs: ${res.statusText}`);
  return res.json();
}

export async function indexSong(file: File, title: string, artist: string): Promise<Song> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', title);
  formData.append('artist', artist);

  const res = await fetch(`${API_BASE}/songs`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to index song: ${res.statusText}`);
  }
  return res.json();
}

export async function deleteSong(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/songs/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete song: ${res.statusText}`);
}

export async function searchAudio(fileOrBlob: Blob | File): Promise<MatchResponse> {
  const formData = new FormData();
  formData.append('file', fileOrBlob, 'query.wav');

  const res = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Search request failed: ${res.statusText}`);
  }
  return res.json();
}
