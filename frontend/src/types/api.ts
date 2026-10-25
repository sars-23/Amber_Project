export interface Song {
  id: number;
  title: string;
  artist: string;
  durationMs: number;
  fingerprintCount: number;
  createdAt: string;
}

export interface MatchScoreDetails {
  peakOffsetBucketMs: number;
  peakVotes: number;
  totalVotes: number;
  medianNoiseVotes: number;
  coherenceScore: number;
  confidence: number;
  histogram: Record<string, number>;
}

export interface MatchResponse {
  matched: boolean;
  song?: Song;
  confidence: number;
  estimatedOffsetMs: number;
  matchedFingerprints: number;
  totalQueryFingerprints: number;
  processingTimeMs: number;
  diagnostics?: MatchScoreDetails;
  message?: string;
}

export interface StatsResponse {
  totalSongs: number;
  totalFingerprints: number;
  systemStatus: string;
  database: string;
  sampleRate: number;
  fftFrameSize: number;
}

export interface HealthResponse {
  status: string;
  service: string;
  timestamp: string;
  databaseConnected: boolean;
}
