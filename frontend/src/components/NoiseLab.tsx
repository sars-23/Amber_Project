import React, { useState } from 'react';
import { FlaskConical, Play, Square, Search, CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react';
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

  // Audio preview reference
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const sourceNodeRef = React.useRef<AudioBufferSourceNode | null>(null);

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop();
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setIsPlaying(false);
  };

  /**
   * Generates a synthetic test audio WAV file representing a multi-tone excerpt
   * optionally blended with Gaussian noise according to the selected SNR slider.
   */
  const createSyntheticTestWav = (withNoise: boolean, snr: number): Blob => {
    const sampleRate = 11025;
    const totalSamples = Math.floor(durationSecs * sampleRate);
    const buffer = new Int16Array(totalSamples);

    // Fundamental notes mimicking chords: C4, E4, G4, A4
    const baseFreqs = [261.63, 329.63, 392.0, 440.0];
    const signalPower = 0.5;

    // SNR in dB => noise power
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
        // Box-Muller Gaussian random noise
        const u1 = Math.random() || 0.0001;
        const u2 = Math.random() || 0.0001;
        const gaussian = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        s += gaussian * noiseStdDev;
      }

      s = Math.max(-1.0, Math.min(1.0, s));
      buffer[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // Wrap in standard WAV RIFF header
    const wavBytes = new Uint8Array(44 + buffer.length * 2);
    const view = new DataView(wavBytes.buffer);

    // RIFF
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + buffer.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // PCM format length
    view.setUint16(20, 1, true); // Audio format 1 (PCM)
    view.setUint16(22, 1, true); // 1 channel
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // Byte rate
    view.setUint16(32, 2, true); // Block align
    view.setUint16(34, 16, true); // Bits per sample
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
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-amber-400" />
            Robustness Noise Lab
          </h2>
          <p className="text-xs text-slate-400">
            Evaluate time-coherent offset matching under controllable Gaussian noise without requiring microphone access
          </p>
        </div>
      </div>

      {/* Control Panel Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-950/60 p-5 rounded-xl border border-slate-800/80 mb-6">
        {/* Track selection */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-2">
            Reference Target
          </label>
          <select
            value={selectedSong?.id || ''}
            onChange={(e) => {
              const id = Number(e.target.value);
              const found = songs.find((s) => s.id === id) || null;
              setSelectedSong(found);
            }}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
          >
            <option value="">Synthetic Test Melody (C4 Major)</option>
            {songs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} — {s.artist}
              </option>
            ))}
          </select>
          <div className="text-[10px] text-slate-500 mt-1">
            Expected ground truth for verification
          </div>
        </div>

        {/* Excerpt offset & duration */}
        <div>
          <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1">
            <span>Excerpt Window</span>
            <span className="font-mono text-amber-400">{durationSecs}s @ offset {offsetSecs}s</span>
          </div>
          <div className="space-y-2">
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={offsetSecs}
              onChange={(e) => setOffsetSecs(Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>Offset: 0.0s</span>
              <span>10.0s</span>
            </div>
          </div>
        </div>

        {/* SNR slider */}
        <div>
          <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1">
            <span>Signal-to-Noise Ratio (SNR)</span>
            <span className="font-mono text-amber-400">+{snrDb} dB</span>
          </div>
          <input
            type="range"
            min={0}
            max={30}
            step={2}
            value={snrDb}
            onChange={(e) => setSnrDb(Number(e.target.value))}
            className="w-full accent-amber-500 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500 mt-1">
            <span>0 dB (Very Heavy Noise)</span>
            <span>+30 dB (Clean Excerpt)</span>
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between pb-6 border-b border-slate-800">
        <button
          onClick={handlePlayPreview}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition-colors"
        >
          {isPlaying ? (
            <>
              <Square className="w-3.5 h-3.5 text-rose-400" />
              Stop Preview
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 text-cyan-400" />
              Listen to Noisy Excerpt
            </>
          )}
        </button>

        <button
          onClick={handleTestRun}
          disabled={isGenerating}
          className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-lg shadow-amber-950/40"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Running Matching Benchmark...
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              Run Recognition Test
            </>
          )}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mt-4 p-4 bg-rose-950/40 border border-rose-800/50 rounded-xl flex items-center gap-3 text-rose-300 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Test results & Ground truth verification */}
      {testResult && (
        <div className="mt-6 space-y-4">
          <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              {testResult.matched ? (
                <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
              ) : (
                <div className="p-2 bg-rose-500/10 text-rose-400 rounded-lg">
                  <XCircle className="w-5 h-5" />
                </div>
              )}
              <div>
                <div className="text-sm font-bold text-white">
                  Evaluation: {testResult.matched ? 'Acoustic Match Confirmed' : 'Below Recognition Threshold'}
                </div>
                <div className="text-xs text-slate-400">
                  Target crop: {durationSecs}s excerpt at offset {(offsetSecs * 1000).toFixed(0)}ms (SNR: +{snrDb} dB)
                </div>
              </div>
            </div>

            <div className="text-right text-xs font-mono">
              <span className="text-slate-400">Latency: </span>
              <span className="text-cyan-400 font-bold">{testResult.processingTimeMs.toFixed(1)} ms</span>
            </div>
          </div>

          <MatchResultCard result={testResult} />
        </div>
      )}
    </div>
  );
};
