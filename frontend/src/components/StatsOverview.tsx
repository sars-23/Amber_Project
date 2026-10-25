import React from 'react';
import { Activity, Database, Music2, Cpu } from 'lucide-react';
import type { StatsResponse, HealthResponse } from '../types/api';

interface StatsOverviewProps {
  stats: StatsResponse | null;
  health: HealthResponse | null;
  loading: boolean;
}

export const StatsOverview: React.FC<StatsOverviewProps> = ({ stats, health, loading }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {/* Indexed Tracks */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase">Indexed Tracks</span>
          <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
            <Music2 className="w-5 h-5" />
          </div>
        </div>
        <div className="text-2xl font-bold tracking-tight text-white">
          {loading ? '—' : stats?.totalSongs ?? 0}
        </div>
        <div className="text-xs text-slate-400 mt-1">Available for acoustic identification</div>
      </div>

      {/* Constellation Fingerprints */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase">Fingerprints</span>
          <div className="p-2 bg-cyan-500/10 text-cyan-400 rounded-lg">
            <Database className="w-5 h-5" />
          </div>
        </div>
        <div className="text-2xl font-bold tracking-tight text-cyan-400 font-mono">
          {loading ? '—' : (stats?.totalFingerprints ?? 0).toLocaleString()}
        </div>
        <div className="text-xs text-slate-400 mt-1">32-bit paired spectral hashes in PostgreSQL</div>
      </div>

      {/* DSP Engine Parameters */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase">DSP Engine</span>
          <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
            <Cpu className="w-5 h-5" />
          </div>
        </div>
        <div className="text-xl font-bold tracking-tight text-emerald-400 font-mono">
          {stats ? `${stats.sampleRate} Hz / N=${stats.fftFrameSize}` : '11,025 Hz / N=1024'}
        </div>
        <div className="text-xs text-slate-400 mt-1">Radix-2 Cooley-Tukey + Hann Window</div>
      </div>

      {/* Engine Status */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase">Engine Status</span>
          <div className="p-2 bg-amber-500/10 text-amber-400 rounded-lg">
            <Activity className="w-5 h-5" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${health?.databaseConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
          <span className="text-lg font-bold text-white capitalize">
            {health?.status ?? 'Connecting...'}
          </span>
        </div>
        <div className="text-xs text-slate-400 mt-1">
          {health?.databaseConnected ? 'PostgreSQL ready for query lookup' : 'Checking database status'}
        </div>
      </div>
    </div>
  );
};
