import type { Song, MatchResponse, StatsResponse, HealthResponse } from '../types/api';

export function getApiBaseUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_API_BASE_URL;
  if (envUrl) {
    const clean = envUrl.replace(/\/+$/, '');
    return clean.endsWith('/api/v1') ? clean : `${clean}/api/v1`;
  }
  // Production fallback when hosted on remote static domain
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return 'https://amber-backend-ler4.onrender.com/api/v1';
  }
  return '/api/v1';
}

export function getWebSocketUrl(): string {
  if ((import.meta as any).env?.VITE_WS_URL) {
    return (import.meta as any).env.VITE_WS_URL;
  }
  const apiBase = getApiBaseUrl();
  if (apiBase && (apiBase.startsWith('http://') || apiBase.startsWith('https://'))) {
    const wsBase = apiBase
      .replace(/^http:\/\//, 'ws://')
      .replace(/^https:\/\//, 'wss://')
      .replace(/\/+$/, '');
    return wsBase.endsWith('/api/v1')
      ? `${wsBase}/ws/audio-stream`
      : `${wsBase}/api/v1/ws/audio-stream`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/v1/ws/audio-stream`;
}

const API_BASE = getApiBaseUrl();

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

export async function fetchSongs(pageOrLimit: number = 0, sizeOrOffset: number = 50): Promise<Song[]> {
  // Support both (page, size) and legacy (limit, offset)
  let page = pageOrLimit;
  let size = sizeOrOffset;
  if (pageOrLimit > 10 && sizeOrOffset === 0) {
    size = pageOrLimit;
    page = 0;
  }
  const offset = page * size;
  const res = await fetch(`${API_BASE}/songs?page=${page}&size=${size}&limit=${size}&offset=${offset}`);
  if (!res.ok) throw new Error(`Failed to fetch songs: ${res.statusText}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.content || [];
}

export async function indexSong(file: File, title: string, artist: string, adminKey?: string): Promise<Song> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', title);
  formData.append('artist', artist);

  const headers: Record<string, string> = {};
  if (adminKey && adminKey.trim()) {
    headers['X-Amber-Admin-Key'] = adminKey.trim();
  }

  const res = await fetch(`${API_BASE}/songs`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    if (res.status === 401) {
      throw new Error('Administrative authentication required. Please provide a valid Admin API Key.');
    }
    if (res.status === 403) {
      throw new Error(errorData.message || 'Forbidden: Invalid administrative credentials or indexing is disabled on the server.');
    }
    throw new Error(errorData.message || `Failed to index song: ${res.statusText}`);
  }
  return res.json();
}

export async function deleteSong(id: number, adminKey?: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (adminKey && adminKey.trim()) {
    headers['X-Amber-Admin-Key'] = adminKey.trim();
  }

  const res = await fetch(`${API_BASE}/songs/${id}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    if (res.status === 401) {
      throw new Error('Administrative authentication required. Please provide a valid Admin API Key to delete tracks.');
    }
    if (res.status === 403) {
      throw new Error(errorData.message || 'Forbidden: Invalid administrative credentials or deletion is disabled on the server.');
    }
    throw new Error(errorData.message || `Failed to delete song: ${res.statusText}`);
  }
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

export async function runBenchmark(
  fileOrBlob?: Blob | File | null,
  snrDb: number = 20.0,
  offsetSecs: number = 2.0,
  durationSecs: number = 4.0
): Promise<import('../types/api').BenchmarkResponse> {
  const formData = new FormData();
  if (fileOrBlob) {
    formData.append('file', fileOrBlob, fileOrBlob instanceof File ? fileOrBlob.name : 'reference.wav');
  }
  formData.append('snrDb', snrDb.toString());
  formData.append('offsetSecs', offsetSecs.toString());
  formData.append('durationSecs', durationSecs.toString());

  const res = await fetch(`${API_BASE}/benchmark/robustness`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Benchmark execution failed: ${res.statusText}`);
  }
  return res.json();
}
