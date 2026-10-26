import React, { useState } from 'react';
import { FlaskConical, Play, Square, AlertCircle, Loader2 } from 'lucide-react';
import { searchAudio } from '../services/apiClient';
import { MatchResultCard } from './MatchResultCard';
import type { Song, MatchResponse } from '../types/api';

interface NoiseLabProps {
  songs: Song[];
}

export const NoiseLab: React.FC<NoiseLabProps> = ({ songs }) => {
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [offsetSecs, setOffsetSecs] = useState<number>(2.0);
  const durationSecs = 4.0;
  const [snrDb, setSnrDb] = useState<number>(20);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<MatchResponse | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const sourceNodeRef = React.useRef<AudioBufferSourceNode | null>(null);

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {
        // Safe ignore
      }
      sourceNodeRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close().catch(() => {});
      } catch {
        // Safe ignore
      }
      audioCtxRef.current = null;
    }
    setIsPlaying(false);
  };

  const createSyntheticTestWav = (withNoise: boolean, snr: number): Blob => {
    const sampleRate = 11025;
    const totalSamples = Math.floor(durationSecs * sampleRate);
    const buffer = new Int16Array(totalSamples);

    const baseFreqs = [261.63, 329.63, 392.0, 440.0];
    const signalPower = 0.5;

    const noisePower = withNoise ? signalPower / Math.pow(10, snr / 10) : 0;
    const noiseStdDev = Math.sqrt(noisePower);

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let s = 0;
      for (const f of baseFreqs) {
        s += Math.sin(2 * Math.PI * f * (t + offsetSecs));
      }
      s = (s / baseFreqs.length) * 0.8;

      if (withNoise) {
        const u1 = Math.random() || 0.0001;
        const u2 = Math.random() || 0.0001;
        const gaussian = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        s += gaussian * noiseStdDev;
      }

      s = Math.max(-1.0, Math.min(1.0, s));
      buffer[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    const wavBytes = new Uint8Array(44 + buffer.length * 2);
    const view = new DataView(wavBytes.buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + buffer.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, buffer.length * 2, true);

    const int16View = new Int16Array(wavBytes.buffer, 44, buffer.length);
    int16View.set(buffer);

    return new Blob([wavBytes], { type: 'audio/wav' });
  };

  const writeString = (view: DataView, offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  const handleTestRun = async () => {
    setIsGenerating(true);
    setError(null);
    setTestResult(null);
    stopAudio();

    try {
      const wavBlob = createSyntheticTestWav(true, snrDb);
      const result = await searchAudio(wavBlob);
      setTestResult(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Noise Lab test execution failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePlayPreview = () => {
    if (isPlaying) {
      stopAudio();
      return;
    }

    const wavBlob = createSyntheticTestWav(true, snrDb);
    const audioCtx = new AudioContext({ sampleRate: 11025 });
    audioCtxRef.current = audioCtx;

    wavBlob.arrayBuffer().then((buf) => {
      audioCtx.decodeAudioData(buf).then((decoded) => {
        const source = audioCtx.createBufferSource();
        source.buffer = decoded;
        source.connect(audioCtx.destination);
        source.onended = () => setIsPlaying(false);
        source.start();
        sourceNodeRef.current = source;
        setIsPlaying(true);
      });
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Title & Introduction */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Noise & Robustness Lab
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Evaluate time-coherent constellation matching under controlled Gaussian additive noise.
        </p>
      </div>

      {/* Main Experiment Setup Card */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
          {/* Reference Target */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Reference Target
            </label>
            <select
              value={selectedSong?.id || ''}
              onChange={(e) => {
                const id = Number(e.target.value);
                const found = songs.find((s) => s.id === id) || null;
                setSelectedSong(found);
              }}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">Synthetic Test Melody (C4 Major)</option>
              {songs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} — {s.artist}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              Ground truth recording
            </p>
          </div>

          {/* Temporal Window */}
          <div>
            <div className="flex justify-between text-xs font-semibold text-gray-700 mb-1.5">
              <span>Temporal Offset</span>
              <span className="font-mono text-amber-700">+{offsetSecs.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={offsetSecs}
              onChange={(e) => setOffsetSecs(Number(e.target.value))}
              className="w-full accent-amber-600 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-gray-500 mt-1">
              <span>0.0s (Start)</span>
              <span>10.0s</span>
            </div>
          </div>

          {/* SNR Slider */}
          <div>
            <div className="flex justify-between text-xs font-semibold text-gray-700 mb-1.5">
              <span>Signal-to-Noise Ratio</span>
              <span className="font-mono text-amber-700">+{snrDb} dB</span>
            </div>
            <input
              type="range"
              min={0}
              max={30}
              step={2}
              value={snrDb}
              onChange={(e) => setSnrDb(Number(e.target.value))}
              className="w-full accent-amber-600 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-gray-500 mt-1">
              <span>0 dB (High Noise)</span>
              <span>+30 dB (Clean)</span>
            </div>
          </div>
        </div>

        {/* Experiment Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
          <button
            onClick={handlePlayPreview}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm self-start"
          >
            {isPlaying ? (
              <>
                <Square className="w-3.5 h-3.5 text-red-600" />
                <span>Stop Audio Preview</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-amber-600" />
                <span>Listen to Noisy Excerpt</span>
              </>
            )}
          </button>

          <button
            onClick={handleTestRun}
            disabled={isGenerating}
            className="flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:bg-gray-200 disabled:text-gray-400 rounded-lg transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Running DSP Pipeline...</span>
              </>
            ) : (
              <>
                <FlaskConical className="w-4 h-4" />
                <span>Execute Robustness Benchmark</span>
              </>
            )}
          </button>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-700 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-500 mt-0.5" />
            <div>
              <p className="font-medium">Benchmark Execution Error</p>
              <p className="text-xs text-red-600 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Results Area */}
        {testResult ? (
          <div className="pt-4 border-t border-gray-100">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Benchmark Results (SNR: +{snrDb} dB)
            </div>
            <MatchResultCard result={testResult} />
          </div>
        ) : (
          <div className="py-8 px-4 border border-dashed border-gray-200 rounded-xl bg-gray-50/50 text-center text-xs text-gray-500">
            Select test parameters and click <strong className="font-semibold text-gray-700">Execute Robustness Benchmark</strong> to test Amber's fingerprinting engine under synthetic acoustic noise.
          </div>
        )}
      </div>
    </div>
  );
};
