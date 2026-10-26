import React, { useState } from 'react';
import { RefreshCw, Search, Library, Mic, FlaskConical, Menu, X, Info } from 'lucide-react';
import type { HealthResponse } from '../types/api';

export type NavigationTab = 'search' | 'library' | 'live' | 'noiselab';

interface HeaderProps {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  health: HealthResponse | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenStatus: () => void;
  songCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  health,
  loading,
  refreshing,
  onRefresh,
  onOpenStatus,
  songCount,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  const isConnected = health?.database === 'CONNECTED';

  const navItems: { id: NavigationTab; label: string; icon: React.FC<{ className?: string }>; badge?: number }[] = [
    { id: 'search', label: 'Identify', icon: Search },
    { id: 'library', label: 'Library', icon: Library, badge: songCount },
    { id: 'live', label: 'Live', icon: Mic },
    { id: 'noiselab', label: 'Noise Lab', icon: FlaskConical },
  ];

  const handleTabClick = (tab: NavigationTab) => {
    onSelectTab(tab);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-8">
          <button
            onClick={() => handleTabClick('search')}
            className="flex items-center gap-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-lg py-1 px-1 -ml-1 text-left"
          >
            {/* Minimal Amber Spectral Wave Mark */}
            <div className="w-8 h-8 rounded-lg bg-amber-600 flex items-center justify-center text-white shadow-sm flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 10v4" />
                <path d="M8 7v10" />
                <path d="M12 4v16" />
                <path d="M16 8v8" />
                <path d="M20 11v2" />
              </svg>
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-gray-900 block leading-tight">
                Amber
              </span>
              <span className="text-[10px] text-gray-500 font-medium block -mt-0.5 tracking-wide">
                Acoustic Recognition
              </span>
            </div>
          </button>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(({ id, label, icon: Icon, badge }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => handleTabClick(id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                    active
                      ? 'bg-amber-50 text-amber-900 font-semibold border border-amber-200/60'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 border border-transparent'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${active ? 'text-amber-700' : 'text-gray-500'}`} />
                  <span>{label}</span>
                  {badge !== undefined && badge > 0 && (
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                      active ? 'bg-amber-200 text-amber-900 font-bold' : 'bg-gray-200/70 text-gray-700'
                    }`}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right Utility Controls */}
        <div className="flex items-center gap-2.5">
          {/* Status Badge */}
          <button
            onClick={onOpenStatus}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              loading
                ? 'bg-gray-50 text-gray-600 border-gray-200'
                : isConnected
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200/80 hover:bg-emerald-100/60'
                : 'bg-amber-50 text-amber-800 border-amber-200/80 hover:bg-amber-100/60'
            }`}
            title="Click to view detailed system health and DSP parameters"
          >
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                loading ? 'bg-gray-400' : isConnected ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            <span className="hidden sm:inline">
              {loading ? 'Checking...' : isConnected ? 'Engine Ready' : 'Connecting...'}
            </span>
            <Info className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
          </button>

          {/* Refresh Action */}
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200/70 shadow-sm"
            title="Refresh database catalog and status"
            aria-label="Refresh data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-amber-600' : ''}`} />
          </button>

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-gray-200 bg-white px-4 pt-2 pb-3 space-y-1">
          {navItems.map(({ id, label, icon: Icon, badge }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => handleTabClick(id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-amber-50 text-amber-900 font-semibold'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${active ? 'text-amber-700' : 'text-gray-500'}`} />
                  <span>{label}</span>
                </div>
                {badge !== undefined && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-gray-100 text-gray-700">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
};
