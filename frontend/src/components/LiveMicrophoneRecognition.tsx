import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Radio, Volume2, AlertCircle, RotateCcw, Activity, Wifi, Cpu, Play } from 'lucide-react';
import { WaveformVisualizer } from './WaveformVisualizer';
import { MatchResultCard } from './MatchResultCard';
import type { MatchResponse } from '../types/api';
import { getWebSocketUrl } from '../services/apiClient';

export interface StreamDiagnostics {
  microphoneState: 'idle' | 'requesting' | 'active' | 'muted' | 'ended' | 'denied';
  audioContextState: AudioContextState | 'uninitialized';
  sampleRate: number;
  pipelineMode: 'AudioWorklet' | 'ScriptProcessor' | 'uninitialized';
  fallbackReason: string | null;
  chunksSent: number;
  bytesSent: number;
  lastSendTime: number | null;
  inputRms: number;
  webSocketState: 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'UNINITIALIZED';
  updatesReceived: number;
  lastUpdateTime: number | null;
  lastMessage: string | null;
  queryFingerprints: number;
  evalLatencyMs: number | null;
  receivedSamples: number;
}

const INITIAL_DIAGNOSTICS: StreamDiagnostics = {
  microphoneState: 'idle',
  audioContextState: 'uninitialized',
  sampleRate: 0,
  pipelineMode: 'uninitialized',
  fallbackReason: null,
  chunksSent: 0,
  bytesSent: 0,
  lastSendTime: null,
  inputRms: 0,
  webSocketState: 'UNINITIALIZED',
  updatesReceived: 0,
  lastUpdateTime: null,
  lastMessage: null,
  queryFingerprints: 0,
  evalLatencyMs: null,
  receivedSamples: 0,
};

// Inline AudioWorklet processor definition used if /pcm-worker.js cannot be fetched
const WORKLET_PROCESSOR_CODE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 11025;
    this.bufferSize = 2048;
    this.outputBuffer = new Int16Array(this.bufferSize);
    this.outputIndex = 0;
    this.phase = 0;
  }

  process(inputs, outputs) {
    if (outputs[0] && outputs[0][0]) {
      outputs[0][0].fill(0);
    }
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const numChannels = input.length;
    const channelLength = input[0].length;
    if (channelLength === 0) return true;

    const currentRate = typeof sampleRate !== 'undefined' ? sampleRate : 44100;
    const ratio = currentRate / this.targetRate;

    if (Math.abs(currentRate - this.targetRate) < 1) {
      for (let i = 0; i < channelLength; i++) {
        let sample = 0;
        for (let ch = 0; ch < numChannels; ch++) sample += input[ch][i];
        sample /= numChannels;
        const s = Math.max(-1, Math.min(1, sample));
        this.outputBuffer[this.outputIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        if (this.outputIndex >= this.bufferSize) {
          const chunk = this.outputBuffer.slice(0, this.bufferSize).buffer;
          this.port.postMessage(chunk, [chunk]);
          this.outputIndex = 0;
        }
      }
    } else {
      while (this.phase < channelLength) {
        const idx0 = Math.floor(this.phase);
        const idx1 = Math.min(idx0 + 1, channelLength - 1);
        const frac = this.phase - idx0;
        let sample0 = 0;
        let sample1 = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          sample0 += input[ch][idx0];
          sample1 += input[ch][idx1];
        }
        sample0 /= numChannels;
        sample1 /= numChannels;
        const interpolated = sample0 + frac * (sample1 - sample0);
        const s = Math.max(-1, Math.min(1, interpolated));
        this.outputBuffer[this.outputIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        if (this.outputIndex >= this.bufferSize) {
          const chunk = this.outputBuffer.slice(0, this.bufferSize).buffer;
          this.port.postMessage(chunk, [chunk]);
          this.outputIndex = 0;
        }
        this.phase += ratio;
      }
      this.phase -= channelLength;
    }
    return true;
  }
}
registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
`;

export const LiveMicrophoneRecognition: React.FC = () => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [latestMatch, setLatestMatch] = useState<MatchResponse | null>(null);
  const [streamStatus, setStreamStatus] = useState<string>('Idle');
  const [interimMessage, setInterimMessage] = useState<string>('Listening to ambient audio...');
  const [sessionSummary, setSessionSummary] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<StreamDiagnostics>(INITIAL_DIAGNOSTICS);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxDurationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagnosticsRef = useRef<StreamDiagnostics>(INITIAL_DIAGNOSTICS);
  const throttledUpdateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Computes root-mean-square amplitude from signed 16-bit PCM buffer
  const computePcmRms = (buffer: ArrayBuffer): number => {
    const int16 = new Int16Array(buffer);
    if (int16.length === 0) return 0;
    let sumSquares = 0;
    // Step by 8 for sub-millisecond calculation
    const step = 8;
    let counted = 0;
    for (let i = 0; i < int16.length; i += step) {
      const norm = int16[i] / 32768.0;
      sumSquares += norm * norm;
      counted++;
    }
    return Math.sqrt(sumSquares / Math.max(1, counted));
  };

  const cleanupAudio = useCallback(() => {
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }

    if (maxDurationTimeoutRef.current) {
      clearTimeout(maxDurationTimeoutRef.current);
      maxDurationTimeoutRef.current = null;
    }

    if (throttledUpdateTimerRef.current) {
      clearInterval(throttledUpdateTimerRef.current);
      throttledUpdateTimerRef.current = null;
    }

    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.disconnect();
      } catch {
        // Safe ignore
      }
      workletNodeRef.current = null;
    }

    if (scriptNodeRef.current) {
      try {
        scriptNodeRef.current.disconnect();
      } catch {
        // Safe ignore
      }
      scriptNodeRef.current = null;
    }

    if (audioContextRef.current) {
      try {
        audioContextRef.current.close().catch(() => {});
      } catch {
        // Safe ignore
      }
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Safe ignore
        }
      });
      streamRef.current = null;
    }
    setStream(null);

    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close(1000, 'User stopped listening');
        }
      } catch {
        // Safe ignore
      }
      wsRef.current = null;
    }

    diagnosticsRef.current = {
      ...diagnosticsRef.current,
      webSocketState: 'CLOSED',
      microphoneState: 'idle',
      audioContextState: 'closed',
    };
    setDiagnostics(diagnosticsRef.current);
  }, []);

  const stopListening = useCallback((customStatus?: string) => {
    setIsListening(false);
    setStreamStatus(customStatus || 'Stopped');
    setLatestMatch((prev) => {
      if (!prev) {
        setSessionSummary('No confident match was identified during this listening session.');
      }
      return prev;
    });
    cleanupAudio();
  }, [cleanupAudio]);

  const resumeSuspendedContext = async () => {
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      try {
        await audioContextRef.current.resume();
        diagnosticsRef.current.audioContextState = audioContextRef.current.state;
        setDiagnostics({ ...diagnosticsRef.current });
      } catch (err) {
        console.error('[Amber Live] Failed to resume AudioContext:', err);
      }
    }
  };

  const startListening = async () => {
    cleanupAudio();
    setErrorMessage(null);
    setLatestMatch(null);
    setSessionSummary(null);
    setInterimMessage('Listening to ambient audio...');
    setStreamStatus('Initializing Pipeline...');

    diagnosticsRef.current = {
      ...INITIAL_DIAGNOSTICS,
      microphoneState: 'requesting',
      webSocketState: 'CONNECTING',
    };
    setDiagnostics({ ...diagnosticsRef.current });

    // 1. Create AudioContext immediately in user gesture context (avoids browser autoplay lock)
    let audioCtx: AudioContext;
    try {
      audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      audioContextRef.current = audioCtx;
      diagnosticsRef.current.sampleRate = audioCtx.sampleRate;
      diagnosticsRef.current.audioContextState = audioCtx.state;

      audioCtx.onstatechange = () => {
        if (audioContextRef.current) {
          diagnosticsRef.current.audioContextState = audioContextRef.current.state;
        }
      };

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
        diagnosticsRef.current.audioContextState = audioCtx.state;
      }
    } catch (e) {
      const errText = e instanceof Error ? e.message : 'AudioContext creation failed';
      setErrorMessage(`Failed to initialize audio subsystem: ${errText}`);
      setStreamStatus('Audio Error');
      return;
    }

    // 2. Request microphone permission
    let mediaStream: MediaStream;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone access requires a secure HTTPS connection or localhost.');
      }

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      streamRef.current = mediaStream;
      setStream(mediaStream);
      diagnosticsRef.current.microphoneState = 'active';

      // Attach track mute / ended event listeners
      const audioTrack = mediaStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onmute = () => {
          diagnosticsRef.current.microphoneState = 'muted';
          setErrorMessage('Microphone input was muted by system or hardware.');
        };
        audioTrack.onunmute = () => {
          diagnosticsRef.current.microphoneState = 'active';
          setErrorMessage(null);
        };
        audioTrack.onended = () => {
          diagnosticsRef.current.microphoneState = 'ended';
          setErrorMessage('Microphone stream ended.');
          stopListening('Microphone Disconnected');
        };
      }
    } catch (err: unknown) {
      let friendlyError = 'Microphone access denied or unavailable.';
      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          friendlyError = 'Microphone permission was denied. Please allow microphone access in your browser to use live recognition.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          friendlyError = 'No audio input device found. Please connect a microphone.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          friendlyError = 'Microphone is already in use by another application.';
        } else if (err.name === 'OverconstrainedError') {
          friendlyError = 'Audio hardware does not satisfy requested constraints.';
        }
      } else if (err instanceof Error) {
        friendlyError = err.message;
      }
      setErrorMessage(friendlyError);
      setStreamStatus('Permission Denied');
      diagnosticsRef.current.microphoneState = 'denied';
      cleanupAudio();
      return;
    }

    // 3. Connect WebSocket
    setStreamStatus('Connecting to Recognition Engine...');
    const wsUrl = getWebSocketUrl();

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to instantiate WebSocket';
      setErrorMessage(`WebSocket initialization error: ${msg}`);
      setStreamStatus('Connection Failed');
      cleanupAudio();
      return;
    }

    // Guard timeout for handshake
    connectionTimeoutRef.current = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        setErrorMessage('WebSocket connection timed out. Ensure the Amber backend service is online.');
        setStreamStatus('Connection Timeout');
        cleanupAudio();
      }
    }, 10000);

    ws.onopen = async () => {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }

      diagnosticsRef.current.webSocketState = 'OPEN';
      setStreamStatus('Stream Ready: Buffering Audio...');
      setIsListening(true);

      // Max 60 seconds listening guard to prevent unattended microphone/buffer capture
      maxDurationTimeoutRef.current = setTimeout(() => {
        stopListening('Session Limit Reached (60s)');
      }, 60000);

      // 4. Build audio processing graph
      try {
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
          diagnosticsRef.current.audioContextState = audioCtx.state;
        }

        const source = audioCtx.createMediaStreamSource(mediaStream);

        // Zero-gain monitor node prevents speaker acoustic feedback loops
        const silentGain = audioCtx.createGain();
        silentGain.gain.setValueAtTime(0, audioCtx.currentTime);
        silentGain.connect(audioCtx.destination);

        let workletLoaded = false;
        let workletErrorDetail: string | null = null;

        // Try AudioWorklet first (via URL, fallback to inline Blob URL)
        try {
          try {
            await audioCtx.audioWorklet.addModule('/pcm-worker.js');
          } catch (fetchErr) {
            console.warn('[Amber Live] Network load of /pcm-worker.js failed, using inlined blob worklet:', fetchErr);
            const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            await audioCtx.audioWorklet.addModule(blobUrl);
            URL.revokeObjectURL(blobUrl);
          }

          const workletNode = new AudioWorkletNode(audioCtx, 'pcm-capture-processor');
          workletNodeRef.current = workletNode;

          workletNode.port.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
              const buffer = event.data;
              const rms = computePcmRms(buffer);
              diagnosticsRef.current.inputRms = rms;

              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                try {
                  wsRef.current.send(buffer);
                  diagnosticsRef.current.chunksSent++;
                  diagnosticsRef.current.bytesSent += buffer.byteLength;
                  diagnosticsRef.current.lastSendTime = Date.now();
                } catch (sendErr) {
                  console.error('[Amber Live] Send PCM buffer failed:', sendErr);
                }
              }
            }
          };

          source.connect(workletNode);
          workletNode.connect(silentGain);
          workletLoaded = true;
          diagnosticsRef.current.pipelineMode = 'AudioWorklet';
          diagnosticsRef.current.fallbackReason = null;
        } catch (workletInitErr) {
          workletErrorDetail = workletInitErr instanceof Error ? workletInitErr.message : String(workletInitErr);
          console.warn('[Amber Live] AudioWorklet initialization failed, activating ScriptProcessor fallback:', workletErrorDetail);
        }

        // ScriptProcessorNode fallback if AudioWorklet fails
        if (!workletLoaded) {
          diagnosticsRef.current.pipelineMode = 'ScriptProcessor';
          diagnosticsRef.current.fallbackReason = workletErrorDetail || 'AudioWorklet unsupported';

          const scriptNode = audioCtx.createScriptProcessor(2048, 1, 1);
          scriptNodeRef.current = scriptNode;

          const currentRate = audioCtx.sampleRate;
          const ratio = currentRate / 11025;
          let phase = 0;
          const targetBuffer = new Int16Array(2048);
          let targetIndex = 0;

          scriptNode.onaudioprocess = (e) => {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
            const inputData = e.inputBuffer.getChannelData(0);

            // Compute input RMS
            let sumSq = 0;
            for (let i = 0; i < inputData.length; i += 8) {
              sumSq += inputData[i] * inputData[i];
            }
            diagnosticsRef.current.inputRms = Math.sqrt(sumSq / (inputData.length / 8));

            if (Math.abs(currentRate - 11025) < 1) {
              for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                targetBuffer[targetIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                if (targetIndex >= 2048) {
                  const chunk = targetBuffer.slice(0, 2048).buffer;
                  wsRef.current.send(chunk);
                  diagnosticsRef.current.chunksSent++;
                  diagnosticsRef.current.bytesSent += chunk.byteLength;
                  diagnosticsRef.current.lastSendTime = Date.now();
                  targetIndex = 0;
                }
              }
            } else {
              while (phase < inputData.length) {
                const idx0 = Math.floor(phase);
                const idx1 = Math.min(idx0 + 1, inputData.length - 1);
                const frac = phase - idx0;
                const interp = inputData[idx0] + frac * (inputData[idx1] - inputData[idx0]);
                const s = Math.max(-1, Math.min(1, interp));
                targetBuffer[targetIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

                if (targetIndex >= 2048) {
                  const chunk = targetBuffer.slice(0, 2048).buffer;
                  wsRef.current.send(chunk);
                  diagnosticsRef.current.chunksSent++;
                  diagnosticsRef.current.bytesSent += chunk.byteLength;
                  diagnosticsRef.current.lastSendTime = Date.now();
                  targetIndex = 0;
                }
                phase += ratio;
              }
              phase -= inputData.length;
            }
          };

          source.connect(scriptNode);
          scriptNode.connect(silentGain);
        }

        // 5. Start throttled UI sync timer (updates state 5 times a second without React render overload)
        throttledUpdateTimerRef.current = setInterval(() => {
          setDiagnostics({ ...diagnosticsRef.current });

          // Watchdog evaluation: if chunks have been sending for >4 seconds with 0 backend replies
          const d = diagnosticsRef.current;
          if (d.chunksSent >= 15 && d.updatesReceived === 0) {
            setStreamStatus('Buffering & Streaming (Awaiting First Recognition)');
          } else if (d.updatesReceived > 0) {
            if (!latestMatch) {
              setStreamStatus('Live Streaming: Continuous Matching');
            }
          }
        }, 200);

      } catch (audioInitErr) {
        console.error('[Amber Live] Audio graph initialization error:', audioInitErr);
        setErrorMessage('Failed to configure audio capture pipeline.');
        stopListening('Audio Init Failed');
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'STREAM_READY') {
          setStreamStatus('Stream Ready: Buffering Audio (2s min)...');
          diagnosticsRef.current.lastMessage = data.message || 'Stream Ready';
          setDiagnostics({ ...diagnosticsRef.current });
          return;
        }

        if (data.type === 'STREAM_ERROR') {
          console.error('[Amber Live] Backend STREAM_ERROR:', data);
          setErrorMessage(data.message || data.error || 'Server audio processing error');
          diagnosticsRef.current.lastMessage = data.message || 'Stream Error';
          setDiagnostics({ ...diagnosticsRef.current });
          return;
        }

        if (data.type === 'MATCH_UPDATE') {
          diagnosticsRef.current.updatesReceived++;
          diagnosticsRef.current.lastUpdateTime = Date.now();
          diagnosticsRef.current.lastMessage = data.message || null;
          diagnosticsRef.current.queryFingerprints = data.totalQueryFingerprints ?? 0;
          diagnosticsRef.current.evalLatencyMs = data.searchDurationMs ?? data.processingTimeMs ?? null;
          diagnosticsRef.current.receivedSamples = data.receivedSamples ?? 0;

          if (data.matched && data.song) {
            const matchData: MatchResponse = {
              matched: true,
              song: data.song,
              confidence: data.confidence ?? 0,
              estimatedOffsetMs: data.estimatedOffsetMs,
              matchedFingerprints: data.matchedFingerprints ?? data.matchingHashes ?? 0,
              totalQueryFingerprints: data.totalQueryFingerprints ?? 0,
              processingTimeMs: data.processingTimeMs ?? data.searchDurationMs ?? 0,
              searchDurationMs: data.searchDurationMs ?? data.processingTimeMs ?? 0,
            };
            setLatestMatch(matchData);
            setStreamStatus('Match Identified');
          } else {
            const queryFps = data.totalQueryFingerprints ?? 0;
            const latency = typeof data.processingTimeMs === 'number'
              ? `${data.processingTimeMs.toFixed(0)}ms`
              : typeof data.searchDurationMs === 'number'
              ? `${data.searchDurationMs.toFixed(0)}ms`
              : '';
            const details = latency ? ` (${queryFps} peaks, ${latency})` : '';
            const serverExplanation = data.message ? `${data.message}` : 'Analyzing audio — listening for match...';
            setInterimMessage(`${serverExplanation}${details}`);
          }

          setDiagnostics({ ...diagnosticsRef.current });
        }
      } catch (e) {
        console.error('[Amber Live] Failed to parse message', e);
      }
    };

    ws.onerror = (e) => {
      console.error('[Amber Live] WebSocket error:', e);
      diagnosticsRef.current.webSocketState = 'CLOSED';
      if (ws.readyState !== WebSocket.OPEN) {
        setErrorMessage('WebSocket connection failed. Ensure the Amber backend service is reachable.');
        setStreamStatus('Connection Error');
      }
    };

    ws.onclose = (event) => {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }

      setIsListening(false);
      diagnosticsRef.current.webSocketState = 'CLOSED';

      if (event.code === 1000) {
        setStreamStatus('Stopped');
      } else if (event.code === 1006) {
        setErrorMessage('WebSocket connection closed abnormally. Verify network connection and backend health.');
        setStreamStatus('Connection Lost');
      } else {
        setStreamStatus(`Disconnected (${event.code})`);
      }
      cleanupAudio();
    };
  };

  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, [cleanupAudio]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Title & Introduction */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Live Recognition
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Stream microphone audio in real-time to continuously match ambient music against Amber's catalog.
        </p>
      </div>

      {/* Control Chamber */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span
              className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                isListening
                  ? 'bg-red-500 animate-pulse'
                  : streamStatus === 'Idle'
                  ? 'bg-gray-400'
                  : 'bg-amber-500'
              }`}
            />
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-700">
              {streamStatus}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {diagnostics.audioContextState === 'suspended' && isListening && (
              <button
                onClick={resumeSuspendedContext}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 shadow-sm animate-bounce"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Resume Audio</span>
              </button>
            )}

            {errorMessage && !isListening && (
              <button
                onClick={startListening}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retry Connection</span>
              </button>
            )}

            <button
              onClick={isListening ? () => stopListening('Stopped') : startListening}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                isListening
                  ? 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500'
                  : 'bg-amber-600 hover:bg-amber-700 text-white focus:ring-amber-500'
              }`}
            >
              {isListening ? (
                <>
                  <MicOff className="w-4 h-4" />
                  <span>Stop Listening</span>
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4" />
                  <span>Start Live Search</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Audio Monitor Canvas */}
        <div>
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
            <span className="flex items-center gap-1.5 font-medium text-gray-700">
              <Volume2 className="w-3.5 h-3.5 text-amber-600" />
              <span>Input Monitor (Time Domain)</span>
            </span>
            <span className="font-mono text-[11px] text-gray-400">11,025 Hz / Mono 16-bit PCM</span>
          </div>
          <WaveformVisualizer stream={stream} isActive={isListening} color="#d97706" height={80} />
        </div>

        {/* Streaming Diagnostics Status Bar */}
        {isListening && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-gray-100 text-xs">
            <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100 space-y-0.5">
              <div className="text-[10px] uppercase font-semibold text-gray-400 flex items-center gap-1">
                <Cpu className="w-3 h-3 text-gray-500" />
                <span>Pipeline</span>
              </div>
              <div className="font-mono font-medium text-gray-800 truncate" title={diagnostics.pipelineMode}>
                {diagnostics.pipelineMode}
              </div>
              <div className="text-[10px] text-gray-500">
                {diagnostics.sampleRate ? `${diagnostics.sampleRate} Hz → 11 kHz` : '11,025 Hz'}
              </div>
            </div>

            <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100 space-y-0.5">
              <div className="text-[10px] uppercase font-semibold text-gray-400 flex items-center gap-1">
                <Activity className="w-3 h-3 text-amber-600" />
                <span>Audio In</span>
              </div>
              <div className="font-mono font-medium text-gray-800">
                {diagnostics.inputRms < 0.0005 ? (
                  <span className="text-amber-600">Near-silent</span>
                ) : (
                  <span className="text-emerald-700">Active ({(diagnostics.inputRms * 100).toFixed(1)}%)</span>
                )}
              </div>
              <div className="text-[10px] text-gray-500">
                Context: {diagnostics.audioContextState}
              </div>
            </div>

            <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100 space-y-0.5">
              <div className="text-[10px] uppercase font-semibold text-gray-400 flex items-center gap-1">
                <Wifi className="w-3 h-3 text-blue-600" />
                <span>Streaming</span>
              </div>
              <div className="font-mono font-medium text-gray-800">
                {diagnostics.chunksSent} frames
              </div>
              <div className="text-[10px] text-gray-500">
                {(diagnostics.bytesSent / 1024).toFixed(0)} KB sent
              </div>
            </div>

            <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100 space-y-0.5">
              <div className="text-[10px] uppercase font-semibold text-gray-400 flex items-center gap-1">
                <Radio className="w-3 h-3 text-emerald-600" />
                <span>Evaluations</span>
              </div>
              <div className="font-mono font-medium text-gray-800">
                {diagnostics.updatesReceived} updates
              </div>
              <div className="text-[10px] text-gray-500">
                {diagnostics.evalLatencyMs ? `${diagnostics.evalLatencyMs.toFixed(0)}ms latency` : 'Awaiting 2s window'}
              </div>
            </div>
          </div>
        )}

        {/* Error Notification */}
        {errorMessage && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-700 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-500 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium">Live Recognition Warning</p>
              <p className="text-xs text-red-600">{errorMessage}</p>
              {diagnostics.fallbackReason && (
                <p className="text-[11px] text-gray-500 font-mono">Worklet reason: {diagnostics.fallbackReason}</p>
              )}
            </div>
          </div>
        )}

        {/* Real-time Status or Match */}
        {latestMatch ? (
          <div className="space-y-3">
            <MatchResultCard result={latestMatch} />
            {isListening && (
              <div className="flex items-center justify-between text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Microphone streaming is active. Click <strong>Stop Listening</strong> when finished.</span>
                </span>
              </div>
            )}
          </div>
        ) : isListening ? (
          <div className="py-8 px-4 border border-dashed border-amber-300 rounded-xl bg-amber-50/40 text-center space-y-2">
            <Radio className="w-6 h-6 text-amber-600 animate-pulse mx-auto" />
            <div className="text-sm font-semibold text-gray-900">{interimMessage}</div>
            <p className="text-xs text-gray-500 max-w-md mx-auto">
              Extracting acoustic constellation peaks across a 4-second rolling window and matching against indexed recordings.
            </p>
            {diagnostics.chunksSent >= 15 && diagnostics.updatesReceived === 0 && (
              <p className="text-[11px] text-amber-700 font-medium">
                Sent {diagnostics.chunksSent} frames ({(diagnostics.bytesSent / 1024).toFixed(0)} KB) — evaluating initial 2.0-second rolling window...
              </p>
            )}
            {diagnostics.lastMessage && diagnostics.updatesReceived > 0 && (
              <div className="inline-block mt-1 px-2.5 py-1 bg-white/80 border border-amber-200 rounded text-[11px] font-mono text-amber-900">
                Last decision: {diagnostics.lastMessage}
              </div>
            )}
          </div>
        ) : sessionSummary ? (
          <div className="py-6 px-4 border border-dashed border-gray-300 rounded-xl bg-gray-50 text-center text-xs text-gray-600 space-y-1">
            <p className="font-semibold text-gray-800">{sessionSummary}</p>
            <p className="text-gray-500 max-w-md mx-auto">
              Tip: Position your microphone closer to the audio source, minimize ambient noise, or ensure the song is indexed in the <span className="font-medium text-gray-700">Library</span>.
            </p>
          </div>
        ) : (
          <div className="py-6 px-4 border border-dashed border-gray-200 rounded-xl bg-gray-50/60 text-center text-xs text-gray-500">
            Press <strong className="font-semibold text-gray-800">Start Live Search</strong> to capture audio through your microphone and identify songs in real time.
          </div>
        )}
      </div>
    </div>
  );
};
