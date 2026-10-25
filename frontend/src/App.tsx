import React, { useState, useEffect, useCallback } from 'react';
import { Waves, Sparkles, RefreshCw, Radio, FlaskConical, Library, FileAudio } from 'lucide-react';
import { fetchStats, fetchHealth, fetchSongs } from './services/apiClient';
import { StatsOverview } from './components/StatsOverview';
import { FileSearch } from './components/FileSearch';
import { SongLibrary } from './components/SongLibrary';
import { LiveMicrophoneRecognition } from './components/LiveMicrophoneRecognition';
import { NoiseLab } from './components/NoiseLab';
import type { Song, StatsResponse, HealthResponse } from './types/api';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'search' | 'library' | 'live' | 'noiselab'>('search');
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    try {
      const [statsData, healthData, songsData] = await Promise.all([
        fetchStats().catch(() => null),
        fetchHealth().catch(() => null),
        fetchSongs(100, 0).catch(() => []),
      ]);
      setStats(statsData);
      setHealth(healthData);
      setSongs(songsData);
    } catch (e) {
      console.error('Failed to load Amber dashboard data', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleManualRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Top Navigation */}
      <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-tr from-amber-500 to-indigo-600 rounded-xl shadow-lg shadow-amber-950/50">
              <Waves className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-amber-100 to-slate-400 bg-clip-text text-transparent">
                  Amber
                </span>
                <span className="text-[10px] font-mono uppercase bg-amber-950 text-amber-400 px-2 py-0.5 rounded-full border border-amber-800/60 font-semibold">
                  Acoustic Engine v1.0
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-medium">
                Radix-2 Cooley-Tukey FFT & Constellation Search
              </p>
            </div>
          </div>

          {/* Quick Refresh */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleManualRefresh}
              disabled={refreshing}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-lg transition-colors"
              title="Refresh engine state"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-cyan-400' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Real-time backend engine statistics */}
        <StatsOverview stats={stats} health={health} loading={loading} />

        {/* Tab Selection */}
        <div className="flex items-center gap-2 p-1.5 bg-slate-900/60 border border-slate-800/80 rounded-2xl mb-6 backdrop-blur-sm max-w-fit overflow-x-auto">
          <button
            onClick={() => setActiveTab('search')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'search'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
            }`}
          >
            <FileAudio className="w-4 h-4" />
            File Identification
          </button>

          <button
            onClick={() => setActiveTab('library')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'library'
                ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/20 font-bold'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
            }`}
          >
            <Library className="w-4 h-4" />
            Catalog Library ({songs.length})
          </button>

          <button
            onClick={() => setActiveTab('live')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'live'
                ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20 font-bold'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
            }`}
          >
            <Radio className="w-4 h-4" />
            Live Microphone
          </button>

          <button
            onClick={() => setActiveTab('noiselab')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'noiselab'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-bold'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
            }`}
          >
            <FlaskConical className="w-4 h-4" />
            Robustness Noise Lab
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'search' && (
          <div className="space-y-6">
            <FileSearch onSearchComplete={loadData} />
          </div>
        )}

        {activeTab === 'library' && (
          <SongLibrary songs={songs} loading={loading} onRefresh={loadData} />
        )}

        {activeTab === 'live' && (
          <LiveMicrophoneRecognition />
        )}

        {activeTab === 'noiselab' && (
          <NoiseLab songs={songs} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/60 py-6 text-center text-xs text-slate-500 bg-slate-950/40">
        <div className="flex items-center justify-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Amber — Custom Java 21 DSP & Spring JDBC Engine paired with React & TypeScript</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
