import { getApiBaseUrl } from './apiClient.ts';
import type { JamendoTrack, OpenMusicImportJob } from '../types/openMusic';

const API_BASE = getApiBaseUrl();

function adminHeaders(adminKey: string): Record<string, string> {
  const key = adminKey.trim();
  if (!key) throw new Error('Enter the Amber Admin API Key to manage music imports.');
  return { 'X-Amber-Admin-Key': key };
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const data = await response.json().catch(() => ({})) as { message?: string; error?: string };
  if (response.status === 401) return new Error('Amber admin authorization is required.');
  if (response.status === 403) return new Error(data.message || 'The Amber Admin API Key was rejected.');
  return new Error(data.message || data.error || `${fallback} (HTTP ${response.status})`);
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
