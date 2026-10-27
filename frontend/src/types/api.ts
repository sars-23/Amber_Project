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
  song?: Song | null;
  confidence: number;
  estimatedOffsetMs?: number;
  matchedFingerprints?: number;
  matchingHashes?: number;
  totalQueryFingerprints?: number;
  processingTimeMs?: number;
  searchDurationMs?: number;
  diagnostics?: MatchScoreDetails;
  offsetHistogram?: { offsetMs: number; votes: number }[];
  message?: string;
}

export interface BenchmarkResponse {
  matched: boolean;
  referenceTitle: string;
  snrDb: number;
  targetOffsetMs: number;
  estimatedOffsetMs: number;
  offsetErrorMs: number;
  score: number;
  confidence: number;
  matchedFingerprints: number;
  matchingHashes?: number;
  totalQueryFingerprints: number;
  totalReferenceFingerprints: number;
  processingTimeMs: number;
  searchDurationMs?: number;
  offsetHistogram?: { offsetMs: number; votes: number }[];
  explanation: string;
}

export interface StatsResponse {
  totalSongs: number;
  totalFingerprints: number;
  totalDurationMs: number;
  totalSearches: number;
  averageSearchLatencyMs: number;
}

export interface HealthResponse {
  status: string;
  version: string;
  database: string;
  sampleRate: number;
  fftSize: number;
  hopSize: number;
}
