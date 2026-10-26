import React, { useState, useEffect, useCallback } from 'react';
import { fetchStats, fetchHealth, fetchSongs } from './services/apiClient';
import { Header, type NavigationTab } from './components/Header';
import { SystemStatusModal } from './components/SystemStatusModal';
import { FileSearch } from './components/FileSearch';
import { SongLibrary } from './components/SongLibrary';
import { BulkImporter } from './components/BulkImporter';
import { LiveMicrophoneRecognition } from './components/LiveMicrophoneRecognition';
import { NoiseLab } from './components/NoiseLab';
import type { Song, StatsResponse, HealthResponse } from './types/api';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavigationTab>('search');
  const [libraryMode, setLibraryMode] = useState<'catalog' | 'bulk'>('catalog');
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState<boolean>(false);

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
    const interval = setInterval(loadData, 12000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleManualRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleTabChange = (tab: NavigationTab) => {
    setActiveTab(tab);
    if (tab === 'library') {
      setLibraryMode('catalog');
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-gray-900 flex flex-col font-sans">
      {/* Top Application Bar */}
      <Header
        activeTab={activeTab}
        onSelectTab={handleTabChange}
        health={health}
        loading={loading}
        refreshing={refreshing}
        onRefresh={handleManualRefresh}
        onOpenStatus={() => setIsStatusModalOpen(true)}
        songCount={songs.length}
      />

      {/* Main Workspace */}
      <main className="flex-1 max-w-6xl mx-auto px-4 sm:px-6 py-8 w-full">
        {/* Primary View: Identify Audio */}
        {activeTab === 'search' && (
          <FileSearch onSearchComplete={loadData} />
        )}

        {/* Primary View: Library & Bulk Ingestion */}
        {activeTab === 'library' && (
          libraryMode === 'catalog' ? (
            <SongLibrary
              songs={songs}
              loading={loading}
              onRefresh={loadData}
              onOpenBulkImport={() => setLibraryMode('bulk')}
            />
          ) : (
            <BulkImporter
              existingSongs={songs}
              onImportComplete={loadData}
              onNavigateToCatalog={() => setLibraryMode('catalog')}
            />
          )
        )}

        {/* Primary View: Live Microphone Recognition */}
        {activeTab === 'live' && (
          <LiveMicrophoneRecognition />
        )}

        {/* Primary View: Robustness & Noise Experimentation */}
        {activeTab === 'noiselab' && (
          <NoiseLab songs={songs} />
        )}
      </main>

      {/* System Status Diagnostic Dialog */}
      <SystemStatusModal
        isOpen={isStatusModalOpen}
        onClose={() => setIsStatusModalOpen(false)}
        stats={stats}
        health={health}
        loading={refreshing}
        onRefresh={handleManualRefresh}
      />

      {/* Minimal Google-style Footer */}
      <footer className="border-t border-gray-200 bg-white py-6 text-center text-xs text-gray-500">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Amber Acoustic Recognition Engine</span>
          <div className="flex items-center gap-4 text-gray-400">
            <button
              onClick={() => setIsStatusModalOpen(true)}
              className="hover:text-gray-600 transition-colors"
            >
              Engine Diagnostics
            </button>
            <span>•</span>
            <span>Java 21 LTS & Spring Boot</span>
            <span>•</span>
            <span>Neon PostgreSQL</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
