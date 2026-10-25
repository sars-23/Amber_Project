import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Radio, Volume2, AlertCircle } from 'lucide-react';
import { WaveformVisualizer } from './WaveformVisualizer';
import { MatchResultCard } from './MatchResultCard';
import type { MatchResponse } from '../types/api';
import { getWebSocketUrl } from '../services/apiClient';

export const LiveMicrophoneRecognition: React.FC = () => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [latestMatch, setLatestMatch] = useState<MatchResponse | null>(null);
  const [streamStatus, setStreamStatus] = useState<string>('Idle');

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  const stopListening = useCallback(() => {
    setIsListening(false);
    setStreamStatus('Stopped');

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Disconnect Worklet & Context
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    // Stop MediaStream Tracks
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  }, [stream]);

  const startListening = async () => {
    setPermissionError(null);
    setLatestMatch(null);
    setStreamStatus('Connecting...');

    try {
      // 1. Request microphone access
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone access requires a secure HTTPS connection or localhost.');
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 11025,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });
      setStream(mediaStream);

      // 2. Establish WebSocket connection
      const wsUrl = getWebSocketUrl();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.binaryType = 'arraybuffer';

      ws.onopen = async () => {
        setStreamStatus('Connected & Streaming');
        setIsListening(true);

        // 3. Audio Context & Worklet setup
        const audioCtx = new AudioContext({ sampleRate: 11025 });
        audioContextRef.current = audioCtx;

        try {
          await audioCtx.audioWorklet.addModule('/pcm-worker.js');
          const source = audioCtx.createMediaStreamSource(mediaStream);
          const workletNode = new AudioWorkletNode(audioCtx, 'pcm-capture-processor');
          workletNodeRef.current = workletNode;

          workletNode.port.onmessage = (event) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(event.data);
            }
          };

          source.connect(workletNode);
          workletNode.connect(audioCtx.destination);
        } catch {
          // Fallback ScriptProcessor if AudioWorklet fails
          const source = audioCtx.createMediaStreamSource(mediaStream);
          const scriptNode = audioCtx.createScriptProcessor(2048, 1, 1);
          scriptNode.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmBuffer = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              const s = Math.max(-1, Math.min(1, inputData[i]));
              pcmBuffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            ws.send(pcmBuffer.buffer);
          };
          source.connect(scriptNode);
          scriptNode.connect(audioCtx.destination);
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
          console.error('Failed to parse WebSocket message', e);
        }
      };

      ws.onerror = () => {
        setPermissionError('WebSocket connection error. Ensure Amber backend is running.');
        stopListening();
      };

      ws.onclose = () => {
        setStreamStatus('Disconnected');
        setIsListening(false);
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Microphone access denied or unavailable.';
      setPermissionError(msg);
      setStreamStatus('Permission Denied');
      stopListening();
    }
  };

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

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
            onClick={isListening ? stopListening : startListening}
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
      {permissionError && (
        <div className="p-4 bg-rose-950/40 border border-rose-800/50 rounded-xl flex items-center gap-3 text-rose-300 text-sm mb-4">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{permissionError}</span>
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
