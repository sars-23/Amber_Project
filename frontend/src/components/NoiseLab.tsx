import React, { useState, useRef } from 'react';
import { FlaskConical, Play, Square, AlertCircle, Loader2, Upload, FileAudio, CheckCircle2, ShieldAlert, Sliders, Info } from 'lucide-react';
import { runBenchmark } from '../services/apiClient';
import type { Song, BenchmarkResponse } from '../types/api';

interface NoiseLabProps {
  songs: Song[];
}

export const NoiseLab: React.FC<NoiseLabProps> = ({ songs }) => {
  const [referenceMode, setReferenceMode] = useState<'builtin' | 'custom'>('builtin');
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [offsetSecs, setOffsetSecs] = useState<number>(2.0);
  const durationSecs = 4.0;
  const [snrDb, setSnrDb] = useState<number>(20);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkResponse | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError('Selected audio file exceeds 10 MB limit for benchmarks.');
      setCustomFile(null);
      return;
    }

    setCustomFile(file);
    setError(null);
    setBenchmarkResult(null);
    stopAudio();
  };

  const handleTestRun = async () => {
    if (referenceMode === 'custom' && !customFile) {
      setError('Please select a clean audio file or switch to the built-in reference track.');
      return;
    }

    setIsRunning(true);
    setError(null);
    setBenchmarkResult(null);
    stopAudio();

    try {
      const fileToSend = referenceMode === 'custom' ? customFile : null;
      const result = await runBenchmark(fileToSend, snrDb, offsetSecs, durationSecs);
      setBenchmarkResult(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Benchmark execution failed');
    } finally {
      setIsRunning(false);
    }
  };

  const handlePlayPreview = async () => {
    if (isPlaying) {
      stopAudio();
      return;
    }

    try {
      const audioCtx = new AudioContext({ sampleRate: 11025 });
      audioCtxRef.current = audioCtx;

      let rawBuffer: AudioBuffer;

      if (referenceMode === 'custom' && customFile) {
        const arrayBuf = await customFile.arrayBuffer();
        rawBuffer = await audioCtx.decodeAudioData(arrayBuf);
      } else {
        // Synthesize 12s benchmark melody
        const sampleRate = 11025;
        const notes = [261.63, 329.63, 392.00, 493.88, 523.25, 659.25, 783.99, 987.77, 880.00, 698.46, 587.33, 392.00];
        const samplesPerNote = sampleRate;
        const totalSamples = samplesPerNote * notes.length;
        rawBuffer = audioCtx.createBuffer(1, totalSamples, sampleRate);
        const channelData = rawBuffer.getChannelData(0);

        for (let noteIdx = 0; noteIdx < notes.length; noteIdx++) {
          const rootFreq = notes[noteIdx];
          const start = noteIdx * samplesPerNote;
          for (let i = 0; i < samplesPerNote; i++) {
            const t = i / sampleRate;
            const env = 0.5 + 0.5 * Math.exp(-1.5 * (i / samplesPerNote));
            const v = (Math.sin(2 * Math.PI * rootFreq * t) +
                       0.8 * Math.sin(2 * Math.PI * rootFreq * 1.25 * t) +
                       0.7 * Math.sin(2 * Math.PI * rootFreq * 1.5 * t)) / 2.5 * env;
            channelData[start + i] = v * 0.8;
          }
        }
      }

      // Slice the excerpt at offsetSecs
      const startSample = Math.floor(Math.max(0, offsetSecs) * rawBuffer.sampleRate);
      const excerptLength = Math.floor(durationSecs * rawBuffer.sampleRate);
      const endSample = Math.min(rawBuffer.length, startSample + excerptLength);
      const actualExcerptLength = endSample - startSample;

      if (actualExcerptLength <= 0) {
        throw new Error('Offset exceeds audio duration.');
      }

      const excerptBuffer = audioCtx.createBuffer(1, actualExcerptLength, rawBuffer.sampleRate);
      const outData = excerptBuffer.getChannelData(0);
      const inData = rawBuffer.getChannelData(0);

      // Compute signal power
      let sumSq = 0;
      for (let i = 0; i < actualExcerptLength; i++) {
        const val = inData[startSample + i];
        sumSq += val * val;
      }
      const signalPower = sumSq / actualExcerptLength;
      const noisePower = signalPower / Math.pow(10, snrDb / 10);
      const noiseStdDev = Math.sqrt(noisePower);

      // Add Gaussian noise
      for (let i = 0; i < actualExcerptLength; i++) {
        const clean = inData[startSample + i];
        const u1 = Math.random() || 0.0001;
        const u2 = Math.random() || 0.0001;
        const gaussian = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        const noisy = clean + gaussian * noiseStdDev;
        outData[i] = Math.max(-1.0, Math.min(1.0, noisy));
      }

      const source = audioCtx.createBufferSource();
      source.buffer = excerptBuffer;
      source.connect(audioCtx.destination);
      source.onended = () => setIsPlaying(false);
      source.start();
      sourceNodeRef.current = source;
      setIsPlaying(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audio preview failed.');
      setIsPlaying(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Title & Introduction */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Noise & Robustness Lab
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Evaluate acoustic constellation fingerprint survival under controlled additive Gaussian noise.
        </p>
      </div>

      {/* Main Experiment Setup Card */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-6">
        {/* Source Mode Toggle */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-2">
            Reference Audio Source
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setReferenceMode('builtin');
                setError(null);
                setBenchmarkResult(null);
                stopAudio();
              }}
              className={`flex items-start gap-3 p-3.5 rounded-lg border text-left transition-all ${
                referenceMode === 'builtin'
                  ? 'border-amber-500 bg-amber-50/50 text-amber-900 ring-1 ring-amber-500'
                  : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700'
              }`}
            >
              <div className="p-2 rounded-md bg-white border border-gray-200 text-amber-600 shadow-xs mt-0.5">
                <FlaskConical className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold">Built-in Benchmark Symphony</div>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  12-second canonical multi-tone acoustic suite (notes C4–B5 with harmonic overtones).
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setReferenceMode('custom');
                setError(null);
                setBenchmarkResult(null);
                stopAudio();
              }}
              className={`flex items-start gap-3 p-3.5 rounded-lg border text-left transition-all ${
                referenceMode === 'custom'
                  ? 'border-amber-500 bg-amber-50/50 text-amber-900 ring-1 ring-amber-500'
                  : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700'
              }`}
            >
              <div className="p-2 rounded-md bg-white border border-gray-200 text-amber-600 shadow-xs mt-0.5">
                <Upload className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold">Supply Clean Reference File</div>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Upload any clean WAV or MP3 recording (max 10 MB / 30s) to benchmark.
                </p>
              </div>
            </button>
          </div>
        </div>

        {/* Custom Audio Upload Dropzone */}
        {referenceMode === 'custom' && (
          <div className="p-4 bg-gray-50 border border-dashed border-gray-300 rounded-xl space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.wav,.mp3,.ogg,.flac"
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <FileAudio className="w-8 h-8 text-amber-600 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-gray-800">
                    {customFile ? customFile.name : 'No audio file selected'}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {customFile
                      ? `${(customFile.size / 1024).toFixed(1)} KB • Ready for in-memory benchmark`
                      : 'WAV, MP3, FLAC, or OGG up to 10 MB'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-xs self-start sm:self-auto"
              >
                {customFile ? 'Change Audio File' : 'Choose File'}
              </button>
            </div>
          </div>
        )}

        {/* Catalog Explanation Callout */}
        {songs.length > 0 && (
          <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg flex items-start gap-2.5 text-xs text-blue-800">
            <Info className="w-4 h-4 flex-shrink-0 text-blue-600 mt-0.5" />
            <p>
              <strong>Database Storage Note:</strong> Amber stores only mathematical constellation hashes in Neon PostgreSQL, not raw audio files. Catalog recordings cannot be altered into noise without their original audio. To benchmark a catalog song, supply its clean audio file above.
            </p>
          </div>
        )}

        {/* Experiment Parameters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
          {/* Temporal Offset */}
          <div>
            <div className="flex justify-between text-xs font-semibold text-gray-700 mb-1.5">
              <span className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-gray-500" />
                <span>Ground-Truth Offset</span>
              </span>
              <span className="font-mono text-amber-700">+{offsetSecs.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min={0}
              max={8}
              step={0.5}
              value={offsetSecs}
              onChange={(e) => setOffsetSecs(Number(e.target.value))}
              className="w-full accent-amber-600 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-gray-500 mt-1">
              <span>0.0s (Beginning)</span>
              <span>8.0s</span>
            </div>
          </div>

          {/* SNR Slider */}
          <div>
            <div className="flex justify-between text-xs font-semibold text-gray-700 mb-1.5">
              <span>Signal-to-Noise Ratio</span>
              <span className="font-mono text-amber-700">+{snrDb} dB SNR</span>
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
              <span>+30 dB (Subtle Noise)</span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={handlePlayPreview}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-xs self-start"
          >
            {isPlaying ? (
              <>
                <Square className="w-3.5 h-3.5 text-red-600" />
                <span>Stop Preview</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-amber-600" />
                <span>Preview Noisy Excerpt</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleTestRun}
            disabled={isRunning || (referenceMode === 'custom' && !customFile)}
            className="flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:bg-gray-200 disabled:text-gray-400 rounded-lg transition-colors shadow-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Executing In-Memory DSP Benchmark...</span>
              </>
            ) : (
              <>
                <FlaskConical className="w-4 h-4" />
                <span>Run In-Memory Robustness Benchmark</span>
              </>
            )}
          </button>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-700 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-500 mt-0.5" />
            <div>
              <p className="font-medium">Benchmark Execution Notice</p>
              <p className="text-xs text-red-600 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Benchmark Results */}
        {benchmarkResult ? (
          <div className="pt-4 border-t border-gray-100 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Benchmark Outcome (+{benchmarkResult.snrDb} dB SNR)
              </span>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                benchmarkResult.matched
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border border-amber-200'
              }`}>
                {benchmarkResult.matched ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Acoustic Constellation Preserved</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                    <span>Peaks Corrupted by Noise</span>
                  </>
                )}
              </span>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div className="text-[11px] text-gray-500">Ground Truth vs Estimated</div>
                <div className="text-sm font-semibold font-mono text-gray-900 mt-0.5">
                  {benchmarkResult.targetOffsetMs}ms → {benchmarkResult.estimatedOffsetMs}ms
                </div>
                <div className={`text-[11px] font-medium mt-0.5 ${
                  benchmarkResult.offsetErrorMs <= 250 ? 'text-emerald-700' : 'text-amber-700'
                }`}>
                  Δ Error: {benchmarkResult.offsetErrorMs} ms
                </div>
              </div>

              <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div className="text-[11px] text-gray-500">Constellation Pairs</div>
                <div className="text-sm font-semibold font-mono text-gray-900 mt-0.5">
                  {benchmarkResult.matchedFingerprints} <span className="text-xs text-gray-500">/ {benchmarkResult.totalQueryFingerprints}</span>
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  Ref Total: {benchmarkResult.totalReferenceFingerprints}
                </div>
              </div>

              <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div className="text-[11px] text-gray-500">Confidence Score</div>
                <div className="text-sm font-semibold font-mono text-gray-900 mt-0.5">
                  {(benchmarkResult.confidence * 100).toFixed(1)}%
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  Coherence: {benchmarkResult.score.toFixed(1)}
                </div>
              </div>

              <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div className="text-[11px] text-gray-500">In-Memory Latency</div>
                <div className="text-sm font-semibold font-mono text-gray-900 mt-0.5">
                  {benchmarkResult.processingTimeMs.toFixed(1)} ms
                </div>
                <div className="text-[11px] text-emerald-700 mt-0.5">Zero DB queries</div>
              </div>
            </div>

            {/* Explanation Note */}
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-700">
              <span className="font-semibold text-gray-900">Analysis: </span>
              <span>{benchmarkResult.explanation}</span>
            </div>
          </div>
        ) : (
          <div className="py-8 px-4 border border-dashed border-gray-200 rounded-xl bg-gray-50/50 text-center text-xs text-gray-500">
            Select test parameters and click <strong className="font-semibold text-gray-700">Run In-Memory Robustness Benchmark</strong> to test Amber's fingerprinting engine under controlled acoustic degradation.
          </div>
        )}
      </div>
    </div>
  );
};
