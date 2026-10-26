import React from 'react';
import { X, CheckCircle2, AlertCircle, Database, Cpu, Music, Hash } from 'lucide-react';
import type { StatsResponse, HealthResponse } from '../types/api';

interface SystemStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: StatsResponse | null;
  health: HealthResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

export const SystemStatusModal: React.FC<SystemStatusModalProps> = ({
  isOpen,
  onClose,
  stats,
  health,
  loading,
  onRefresh,
}) => {
  if (!isOpen) return null;

  const isConnected = health?.database === 'CONNECTED';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="system-status-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 id="system-status-title" className="text-base font-semibold text-gray-900">
              Amber System Status
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Real-time diagnostic metrics from backend and PostgreSQL persistence
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Main Health Banner */}
          <div className={`p-4 rounded-lg border flex items-center justify-between ${
            isConnected
              ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
              : 'bg-amber-50/70 border-amber-200 text-amber-900'
          }`}>
            <div className="flex items-center gap-3">
              {isConnected ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              )}
              <div>
                <div className="text-sm font-medium">
                  {isConnected ? 'Recognition Engine Operational' : 'Connecting to Engine...'}
                </div>
                <div className="text-xs text-gray-600 mt-0.5">
                  {isConnected
                    ? 'PostgreSQL constellation store online & accepting queries'
                    : 'Backend connection pending or database unreachable'}
                </div>
              </div>
            </div>
            <button
              onClick={onRefresh}
              disabled={loading}
              className="text-xs font-medium text-gray-600 hover:text-gray-900 px-2.5 py-1 rounded bg-white/80 border border-gray-200 shadow-sm"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-3">
            {/* Database status */}
            <div className="p-3.5 bg-gray-50 rounded-lg border border-gray-200/80">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <Database className="w-3.5 h-3.5 text-gray-400" />
                <span>Database</span>
              </div>
              <div className="text-sm font-semibold text-gray-900">
                {health?.database ?? 'Disconnected'}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                Neon PostgreSQL
              </div>
            </div>

            {/* DSP Rate */}
            <div className="p-3.5 bg-gray-50 rounded-lg border border-gray-200/80">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <Cpu className="w-3.5 h-3.5 text-gray-400" />
                <span>DSP Sample Rate</span>
              </div>
              <div className="text-sm font-semibold font-mono text-gray-900">
                {health ? `${health.sampleRate.toLocaleString()} Hz` : '11,025 Hz'}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                Radix-2 FFT (N={health?.fftSize ?? 1024})
              </div>
            </div>

            {/* Indexed Tracks */}
            <div className="p-3.5 bg-gray-50 rounded-lg border border-gray-200/80">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <Music className="w-3.5 h-3.5 text-gray-400" />
                <span>Catalog Tracks</span>
              </div>
              <div className="text-sm font-semibold text-gray-900">
                {stats?.totalSongs ?? 0} recordings
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                Active reference songs
              </div>
            </div>

            {/* Total Fingerprints */}
            <div className="p-3.5 bg-gray-50 rounded-lg border border-gray-200/80">
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <Hash className="w-3.5 h-3.5 text-gray-400" />
                <span>Fingerprint Hashes</span>
              </div>
              <div className="text-sm font-semibold font-mono text-gray-900">
                {(stats?.totalFingerprints ?? 0).toLocaleString()}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                32-bit paired points
              </div>
            </div>
          </div>

          {/* Engine Parameters Detailed List */}
          <div className="pt-2 border-t border-gray-100">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Acoustic Pipeline Parameters
            </h3>
            <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
              <dt className="text-gray-500">Sampling Strategy:</dt>
              <dd className="font-medium text-gray-800">11,025 Hz Mono Downsampled</dd>
              <dt className="text-gray-500">Transform Window:</dt>
              <dd className="font-medium text-gray-800">Hann Window, N=1024, Hop=512</dd>
              <dt className="text-gray-500">Target Zone Pairing:</dt>
              <dd className="font-medium text-gray-800">Constellation Hash (Anchor + Target)</dd>
              <dt className="text-gray-500">Match Algorithm:</dt>
              <dd className="font-medium text-gray-800">Time-offset Histogram Voting</dd>
            </dl>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            Version: {health?.version ?? '1.0.0'}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
