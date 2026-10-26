import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Radio, Volume2, AlertCircle, RotateCcw } from 'lucide-react';
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
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
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

    // 1. Request microphone permission
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
      cleanupAudio();
      return;
    }

    // 2. Establish WebSocket connection
    setStreamStatus('Connecting to Backend...');
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

    // Guard timeout
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

      setStreamStatus('Connected & Streaming');
      setIsListening(true);

      // 3. Audio graph with zero-gain speaker feedback prevention
      try {
        let audioCtx: AudioContext;
        try {
          audioCtx = new AudioContext({ sampleRate: 11025 });
        } catch {
          audioCtx = new AudioContext();
        }
        audioContextRef.current = audioCtx;

        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }

        const source = audioCtx.createMediaStreamSource(mediaStream);

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
        } catch {
          // Fallback to ScriptProcessor if Worklet fails
        }

        if (!workletLoaded) {
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
        }
      } catch (audioInitErr) {
        console.error('[Amber Live] Audio context error:', audioInitErr);
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
        }
      } catch (e) {
        console.error('[Amber Live] Failed to parse message', e);
      }
    };

    ws.onerror = (e) => {
      console.error('[Amber Live] WebSocket error:', e);
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
            <span className="font-mono text-[11px] text-gray-400">11,025 Hz / Mono 16-bit</span>
          </div>
          <WaveformVisualizer stream={stream} isActive={isListening} color="#d97706" height={80} />
        </div>

        {/* Error Notification */}
        {errorMessage && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-700 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-500 mt-0.5" />
            <div>
              <p className="font-medium">Live Recognition Warning</p>
              <p className="text-xs text-red-600 mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Real-time Status or Match */}
        {latestMatch ? (
          <MatchResultCard result={latestMatch} />
        ) : isListening ? (
          <div className="py-8 px-4 border border-dashed border-amber-300 rounded-xl bg-amber-50/40 text-center">
            <Radio className="w-6 h-6 text-amber-600 animate-pulse mx-auto mb-2" />
            <div className="text-sm font-semibold text-gray-900">Listening to ambient audio...</div>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              Extracting acoustic constellation peaks across a 4-second rolling window and matching against indexed recordings.
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
