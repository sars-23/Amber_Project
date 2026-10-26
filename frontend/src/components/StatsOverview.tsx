import React from 'react';
import { Database, Music2, Cpu, Activity } from 'lucide-react';
import type { StatsResponse, HealthResponse } from '../types/api';

interface StatsOverviewProps {
  stats: StatsResponse | null;
  health: HealthResponse | null;
  loading: boolean;
}

export const StatsOverview: React.FC<StatsOverviewProps> = ({ stats, health, loading }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>Catalog Recordings</span>
          <Music2 className="w-4 h-4 text-gray-400" />
        </div>
        <div className="text-xl font-bold text-gray-900">
          {loading ? '—' : stats?.totalSongs ?? 0}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>Total Fingerprints</span>
          <Database className="w-4 h-4 text-gray-400" />
        </div>
        <div className="text-xl font-bold font-mono text-gray-900">
          {loading ? '—' : (stats?.totalFingerprints ?? 0).toLocaleString()}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>DSP Pipeline</span>
          <Cpu className="w-4 h-4 text-gray-400" />
        </div>
        <div className="text-lg font-bold font-mono text-gray-900">
          {health ? `${health.sampleRate.toLocaleString()} Hz` : '11,025 Hz'}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>Engine Status</span>
          <Activity className="w-4 h-4 text-gray-400" />
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${health?.database === 'CONNECTED' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span className="text-sm font-semibold text-gray-900">
            {health?.database === 'CONNECTED' ? 'Ready' : 'Connecting'}
          </span>
        </div>
      </div>
    </div>
  );
};
