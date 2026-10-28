export interface JamendoTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSeconds: number;
  sourceUrl: string;
  licenseUrl: string;
  licenseName: string;
  attributionText: string;
}

export interface OpenMusicImportItem {
  id: string;
  provider: string;
  externalTrackId: string;
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number;
  sourceUrl: string;
  licenseUrl: string;
  attributionText: string;
  status: 'PENDING' | 'PROCESSING' | 'IMPORTED' | 'SKIPPED' | 'FAILED' | 'CANCELLED' | string;
  attempts: number;
  errorMessage: string | null;
  downloadedBytes: number | null;
  contentSha256: string | null;
  songId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpenMusicImportJob {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | string;
  total: number;
  queued: number;
  processing: number;
  imported: number;
  skipped: number;
  failed: number;
  cancelled: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  items: OpenMusicImportItem[];
}
