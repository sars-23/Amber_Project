import { getApiBaseUrl } from './apiClient.ts';
import type { JamendoTrack, OpenMusicImportJob } from '../types/openMusic';

const API_BASE = getApiBaseUrl();

function adminHeaders(adminKey: string): Record<string, string> {
  const key = adminKey.trim();
  if (!key) throw new Error('Enter the Amber Admin API Key to manage music imports.');
  return { 'X-Amber-Admin-Key': key };
}

export interface ApiErrorResponse {
  message?: string;
  error?: string;
  trackId?: string;
  reasonCode?: string;
}

export class OpenMusicError extends Error {
  trackId?: string;
  reasonCode?: string;

  constructor(message: string, trackId?: string, reasonCode?: string) {
    super(message);
    this.name = 'OpenMusicError';
    this.trackId = trackId;
    this.reasonCode = reasonCode;
  }
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const data = await response.json().catch(() => ({})) as ApiErrorResponse;
  const message = data.message || data.error || `${fallback} (HTTP ${response.status})`;
  if (response.status === 401) return new OpenMusicError('Amber admin authorization is required.');
  if (response.status === 403) return new OpenMusicError(data.message || 'The Amber Admin API Key was rejected.');
  if (response.status === 429) return new OpenMusicError('Search rate limit reached. Please wait a moment before searching again.');
  return new OpenMusicError(message, data.trackId, data.reasonCode);
}

export async function searchOpenMusicTracks(query: string, limit = 20): Promise<JamendoTrack[]> {
  const url = `${API_BASE}/open-music/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) throw await responseError(response, 'Music search failed');
  return response.json() as Promise<JamendoTrack[]>;
}

export async function startOpenMusicImport(trackIds: string[], adminKey: string): Promise<OpenMusicImportJob> {
  const response = await fetch(`${API_BASE}/open-music/jobs`, {
    method: 'POST',
    headers: { ...adminHeaders(adminKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackIds }),
  });
  if (!response.ok) throw await responseError(response, 'Could not start import');
  return response.json() as Promise<OpenMusicImportJob>;
}

export async function fetchOpenMusicImportJob(id: string, adminKey: string): Promise<OpenMusicImportJob> {
  const response = await fetch(`${API_BASE}/open-music/jobs/${encodeURIComponent(id)}`, {
    headers: adminHeaders(adminKey),
  });
  if (!response.ok) throw await responseError(response, 'Could not load import job');
  return response.json() as Promise<OpenMusicImportJob>;
}

export async function fetchActiveOpenMusicJobs(adminKey: string): Promise<OpenMusicImportJob[]> {
  const response = await fetch(`${API_BASE}/open-music/jobs/active`, {
    headers: adminHeaders(adminKey),
  });
  if (!response.ok) throw await responseError(response, 'Could not resume import jobs');
  return response.json() as Promise<OpenMusicImportJob[]>;
}

export async function retryFailedOpenMusicImport(id: string, adminKey: string): Promise<OpenMusicImportJob> {
  const response = await fetch(`${API_BASE}/open-music/jobs/${encodeURIComponent(id)}/retry-failed`, {
    method: 'POST',
    headers: adminHeaders(adminKey),
  });
  if (!response.ok) throw await responseError(response, 'Could not retry failed tracks');
  return response.json() as Promise<OpenMusicImportJob>;
}

export async function cancelOpenMusicImport(id: string, adminKey: string): Promise<OpenMusicImportJob> {
  const response = await fetch(`${API_BASE}/open-music/jobs/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    headers: adminHeaders(adminKey),
  });
  if (!response.ok) throw await responseError(response, 'Could not cancel import');
  return response.json() as Promise<OpenMusicImportJob>;
}
