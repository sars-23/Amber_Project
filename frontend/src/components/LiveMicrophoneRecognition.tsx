import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Radio, Volume2, AlertCircle } from 'lucide-react';
import { WaveformVisualizer } from './WaveformVisualizer';
import { MatchResultCard } from './MatchResultCard';
import type { MatchResponse } from '../types/api';
import { getWebSocketUrl } from '../services/apiClient';

export const LiveMicrophoneRecognition: React.FC = () => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [latestMatch, setLatestMatch] = useState<MatchResponse | null>(null);
  const [streamStatus, setStreamStatus] = useState<string>('Idle');

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanupAudio = useCallback(() => {
    // Clear connection timeout
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }

    // Disconnect Worklet Node
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.disconnect();
      } catch {
        // Safe ignore on disconnect
      }
      workletNodeRef.current = null;
    }

    // Disconnect ScriptProcessor Node
    if (scriptNodeRef.current) {
      try {
        scriptNodeRef.current.disconnect();
      } catch {
        // Safe ignore on disconnect
      }
      scriptNodeRef.current = null;
    }

    // Close AudioContext
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close().catch(() => {});
      } catch {
        // Safe ignore
      }
      audioContextRef.current = null;
    }

    // Stop MediaStream Tracks
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

    // Close WebSocket
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
  }, []);

  const stopListening = useCallback((customStatus?: string) => {
    setIsListening(false);
    setStreamStatus(customStatus || 'Stopped');
    cleanupAudio();
  }, [cleanupAudio]);

  const startListening = async () => {
    cleanupAudio();
    setErrorMessage(null);
    setLatestMatch(null);
    setStreamStatus('Requesting Microphone...');

    let mediaStream: MediaStream;

    // 1. Request microphone access with descriptive diagnostics
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone access requires a secure HTTPS connection or localhost.');
      }

      console.log('[Amber Live] Requesting microphone access...');
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
      console.log('[Amber Live] Microphone access granted.');
    } catch (err: unknown) {
      let friendlyError = 'Microphone access denied or unavailable.';
      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          friendlyError = 'Microphone permission denied. Please allow microphone access in your browser settings to use live recognition.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          friendlyError = 'No microphone device found. Please attach an audio input device.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          friendlyError = 'Microphone is currently in use by another application or process.';
        } else if (err.name === 'OverconstrainedError') {
          friendlyError = 'Microphone hardware does not satisfy requested audio constraints.';
        }
      } else if (err instanceof Error) {
        friendlyError = err.message;
      }
      console.warn('[Amber Live] Microphone error:', friendlyError);
      setErrorMessage(friendlyError);
      setStreamStatus('Permission Denied');
      cleanupAudio();
      return;
    }

    // 2. Establish WebSocket connection
    setStreamStatus('Connecting to Backend...');
    const wsUrl = getWebSocketUrl();
    console.log('[Amber Live] Connecting WebSocket to:', wsUrl);

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to instantiate WebSocket';
      console.error('[Amber Live] WebSocket creation error:', msg);
      setErrorMessage(`WebSocket initialization error: ${msg}`);
      setStreamStatus('Connection Failed');
      cleanupAudio();
      return;
    }

    // Set 10-second connection timeout guard
    connectionTimeoutRef.current = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.warn('[Amber Live] WebSocket connection timed out after 10s');
        setErrorMessage('WebSocket connection timed out. Ensure the Amber backend service is online and accessible.');
        setStreamStatus('Connection Timeout');
        cleanupAudio();
      }
    }, 10000);

    ws.onopen = async () => {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }

      console.log('[Amber Live] WebSocket connection established successfully.');
      setStreamStatus('Connected & Streaming');
      setIsListening(true);

      // 3. Setup AudioContext and AudioWorklet
      try {
        let audioCtx: AudioContext;
        try {
          audioCtx = new AudioContext({ sampleRate: 11025 });
        } catch {
          // Fallback to system hardware sample rate if 11,025 Hz is not natively supported
          console.log('[Amber Live] Context sampleRate 11,025 Hz not natively supported, falling back to system rate');
          audioCtx = new AudioContext();
        }
        audioContextRef.current = audioCtx;

        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }

        const source = audioCtx.createMediaStreamSource(mediaStream);

        // Silent GainNode to keep audio graph processing without routing mic to speakers (prevents feedback)
        const silentGain = audioCtx.createGain();
        silentGain.gain.setValueAtTime(0, audioCtx.currentTime);
        silentGain.connect(audioCtx.destination);

        let workletLoaded = false;
        try {
          await audioCtx.audioWorklet.addModule('/pcm-worker.js');
          const workletNode = new AudioWorkletNode(audioCtx, 'pcm-capture-processor');
          workletNodeRef.current = workletNode;

          workletNode.port.onmessage = (event) => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              try {
                wsRef.current.send(event.data);
              } catch (e) {
                console.error('[Amber Live] Send PCM buffer failed:', e);
              }
            }
          };

          source.connect(workletNode);
          workletNode.connect(silentGain);
          workletLoaded = true;
          console.log('[Amber Live] AudioWorklet PCM processor active');
        } catch (workletErr) {
          console.warn('[Amber Live] AudioWorklet failed, using ScriptProcessor fallback:', workletErr);
        }

        if (!workletLoaded) {
          // Fallback ScriptProcessor
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

            if (Math.abs(currentRate - 11025) < 1) {
              for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                targetBuffer[targetIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                if (targetIndex >= 2048) {
                  const chunk = targetBuffer.slice(0, 2048).buffer;
                  wsRef.current.send(chunk);
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
                  targetIndex = 0;
                }
                phase += ratio;
              }
              phase -= inputData.length;
            }
          };

          source.connect(scriptNode);
          scriptNode.connect(silentGain);
          console.log('[Amber Live] ScriptProcessor PCM streaming active');
        }
      } catch (audioInitErr) {
        console.error('[Amber Live] Audio context initialization error:', audioInitErr);
        setErrorMessage('Failed to initialize audio capture pipeline.');
        stopListening('Audio Init Failed');
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'MATCH_UPDATE') {
          const matchData: MatchResponse = {
            matched: data.matched,
            song: data.song,
            confidence: data.confidence,
            estimatedOffsetMs: data.estimatedOffsetMs,
            matchedFingerprints: data.matchedFingerprints,
            totalQueryFingerprints: data.totalQueryFingerprints,
            processingTimeMs: data.processingTimeMs,
            message: data.matched ? undefined : 'Listening for song fingerprint...',
          };
          setLatestMatch(matchData);
        } else if (data.type === 'RESET_ACK') {
          console.log('[Amber Live] Server buffer reset acknowledged');
        }
      } catch (e) {
        console.error('[Amber Live] Failed to parse WebSocket message', e);
      }
    };

    ws.onerror = (e) => {
      console.error('[Amber Live] WebSocket transport error:', e);
      if (ws.readyState !== WebSocket.OPEN) {
        setErrorMessage('WebSocket connection failed. Ensure Amber backend is running and accepts connections.');
        setStreamStatus('Connection Error');
      }
    };

    ws.onclose = (event) => {
      console.log(`[Amber Live] WebSocket closed: code=${event.code}, reason=${event.reason || 'None'}, wasClean=${event.wasClean}`);
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }

      setIsListening(false);
      if (event.code === 1000) {
        setStreamStatus('Stopped');
      } else if (event.code === 1006) {
        setErrorMessage('WebSocket connection closed abnormally. Check network connection or backend availability.');
        setStreamStatus('Connection Lost');
      } else if (event.code === 1008) {
        setErrorMessage('WebSocket connection rejected by backend origin policy.');
        setStreamStatus('Forbidden');
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
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Radio className="w-5 h-5 text-rose-500 animate-pulse" />
            Live Microphone Recognition
          </h2>
          <p className="text-xs text-slate-400">
            Real-time AudioWorklet capture streaming 16-bit PCM @ 11,025 Hz directly over WebSocket
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-slate-400 flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                isListening ? 'bg-rose-500 animate-ping' : 'bg-slate-600'
              }`}
            />
            {streamStatus}
          </span>

          <button
            onClick={isListening ? () => stopListening('Stopped') : startListening}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg ${
              isListening
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/40'
                : 'bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white shadow-rose-900/30'
            }`}
          >
            {isListening ? (
              <>
                <MicOff className="w-4 h-4" />
                Stop Listening
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                Start Live Search
              </>
            )}
          </button>
        </div>
      </div>

      {/* Waveform Visualizer */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
          <span className="flex items-center gap-1.5">
            <Volume2 className="w-4 h-4 text-cyan-400" />
            Live Input Monitor (Time Domain)
          </span>
          <span className="font-mono text-slate-500">11,025 Hz / Mono</span>
        </div>
        <WaveformVisualizer stream={stream} isActive={isListening} color="#f43f5e" height={90} />
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="p-4 bg-rose-950/40 border border-rose-800/50 rounded-xl flex items-center gap-3 text-rose-300 text-sm mb-4">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Real-time Match Card */}
      {latestMatch ? (
        <MatchResultCard result={latestMatch} />
      ) : isListening ? (
        <div className="p-6 border border-dashed border-rose-900/40 rounded-xl bg-rose-950/10 text-center text-slate-400">
          <Radio className="w-6 h-6 text-rose-400 animate-pulse mx-auto mb-2" />
          <div className="text-sm font-semibold text-slate-200">Listening to ambient audio...</div>
          <div className="text-xs text-slate-500 mt-1">
            Analyzing 4-second rolling window across indexed constellation fingerprints
          </div>
        </div>
      ) : (
        <div className="p-6 border border-dashed border-slate-800 rounded-xl bg-slate-950/40 text-center text-slate-500 text-xs">
          Press <strong>Start Live Search</strong> to identify ambient songs playing near your microphone.
        </div>
      )}
    </div>
  );
};
