import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Radio, Volume2, AlertCircle, RotateCcw, Activity, Wifi, Cpu, Play, Sliders, AlertTriangle, ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import { WaveformVisualizer } from './WaveformVisualizer';
import { MatchResultCard } from './MatchResultCard';
import type { MatchResponse, MatchDiagnostics } from '../types/api';
import { getWebSocketUrl } from '../services/apiClient';
import { PolyphaseResampler, calculatePcmMetrics, type ResamplerMetrics } from '../utils/resampler';

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
  rmsDbfs: number;
  peakAmplitude: number;
  clippedSamples: number;
  clippingPercentage: number;
  zeroPercentage: number;
  webSocketState: 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'UNINITIALIZED';
  updatesReceived: number;
  lastUpdateTime: number | null;
  lastMessage: string | null;
  queryFingerprints: number;
  evalLatencyMs: number | null;
  receivedSamples: number;
}

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
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
  rmsDbfs: -100,
  peakAmplitude: 0,
  clippedSamples: 0,
  clippingPercentage: 0,
  zeroPercentage: 0,
  webSocketState: 'UNINITIALIZED',
  updatesReceived: 0,
  lastUpdateTime: null,
  lastMessage: null,
  queryFingerprints: 0,
  evalLatencyMs: null,
  receivedSamples: 0,
};

// Inline AudioWorklet processor definition with genuinely symmetric polyphase windowed-sinc resampler
const WORKLET_PROCESSOR_CODE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 11025;
    this.bufferSize = 2048;
    this.outputBuffer = new Int16Array(this.bufferSize);
    this.outputIndex = 0;

    const currentRate = typeof sampleRate !== 'undefined' ? sampleRate : 48000;
    this.inputRate = currentRate;
    this.ratio = this.inputRate / this.targetRate;

    this.M = this.inputRate >= 88200 ? 128 : 64;
    this.numTaps = 2 * this.M + 1;
    this.P = 128;
    this.phase = 0.0;
    this.history = new Float32Array(this.numTaps);

    this.dcR = Math.max(0.99, 1.0 - (2.0 * Math.PI * 20.0 / this.inputRate));
    this.dcXPrev = 0.0;
    this.dcYPrev = 0.0;

    const effectiveCutoff = Math.min(4800, (this.targetRate / 2) * 0.92);
    const normalizedCutoff = effectiveCutoff / this.inputRate;
    this.polyTable = new Float32Array(this.P * this.numTaps);

    for (let p = 0; p < this.P; p++) {
      const frac = p / this.P;
      const offset = p * this.numTaps;
      let sum = 0.0;

      for (let idx = 0; idx < this.numTaps; idx++) {
        const k = idx - this.M;
        const t = k - frac;

        let sincVal;
        if (Math.abs(t) < 1e-9) {
          sincVal = 2.0 * normalizedCutoff;
        } else {
          sincVal = Math.sin(2.0 * Math.PI * normalizedCutoff * t) / (Math.PI * t);
        }

        const wArg = Math.abs(t) / this.M;
        let win = 0.0;
        if (wArg <= 1.0) {
          win = 0.42 + 0.5 * Math.cos(Math.PI * wArg) + 0.08 * Math.cos(2.0 * Math.PI * wArg);
        }

        const tapVal = sincVal * win;
        this.polyTable[offset + idx] = tapVal;
        sum += tapVal;
      }

      if (sum !== 0.0) {
        for (let j = 0; j < this.numTaps; j++) {
          this.polyTable[offset + j] /= sum;
        }
      }
    }

    this.intervalTotal = 0;
    this.intervalClipped = 0;
    this.intervalZeros = 0;
    this.intervalPeak = 0;
    this.intervalSumSq = 0;
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

    const monoInput = new Float32Array(channelLength);
    const R = this.dcR;

    for (let i = 0; i < channelLength; i++) {
      let rawSample = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        rawSample += input[ch][i];
      }
      rawSample /= numChannels;

      const dcFiltered = rawSample - this.dcXPrev + R * this.dcYPrev;
      this.dcXPrev = rawSample;
      this.dcYPrev = dcFiltered;

      monoInput[i] = dcFiltered;

      const absSample = Math.abs(dcFiltered);
      if (absSample > this.intervalPeak) this.intervalPeak = absSample;
      if (absSample >= 0.999) this.intervalClipped++;
      if (absSample < 1e-5) this.intervalZeros++;
      this.intervalSumSq += dcFiltered * dcFiltered;
    }
    this.intervalTotal += channelLength;

    if (Math.abs(this.inputRate - this.targetRate) < 1.0) {
      for (let i = 0; i < channelLength; i++) {
        const s = Math.max(-1.0, Math.min(1.0, monoInput[i]));
        this.outputBuffer[this.outputIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        if (this.outputIndex >= this.bufferSize) {
          this.emitChunk();
        }
      }
      return true;
    }

    const fullLen = this.numTaps + channelLength;
    const fullBuf = new Float32Array(fullLen);
    fullBuf.set(this.history, 0);
    fullBuf.set(monoInput, this.numTaps);

    while (this.phase + this.M <= fullLen - 1 - this.M) {
      const center = this.phase + this.M;
      const idx = Math.floor(center);
      const frac = center - idx;
      const pIdx = Math.min(this.P - 1, Math.max(0, Math.floor(frac * this.P)));
      const pOffset = pIdx * this.numTaps;

      let conv = 0.0;
      for (let k = 0; k < this.numTaps; k++) {
        conv += fullBuf[idx - this.M + k] * this.polyTable[pOffset + k];
      }

      const s = Math.max(-1.0, Math.min(1.0, conv));
      this.outputBuffer[this.outputIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

      if (this.outputIndex >= this.bufferSize) {
        this.emitChunk();
      }

      this.phase += this.ratio;
    }

    this.phase -= channelLength;
    this.history.set(fullBuf.subarray(fullLen - this.numTaps));
    return true;
  }

  emitChunk() {
    const chunk = this.outputBuffer.slice(0, this.bufferSize).buffer;
    const total = Math.max(1, this.intervalTotal);
    const rms = Math.sqrt(this.intervalSumSq / total);
    const rmsDbfs = rms <= 1e-5 ? -100 : Math.max(-100, Math.round(20 * Math.log10(rms)));

    const metrics = {
      totalSamples: this.intervalTotal,
      clippedSamples: this.intervalClipped,
      clippingPercentage: (this.intervalClipped / total) * 100.0,
      zeroPercentage: (this.intervalZeros / total) * 100.0,
      peakAmplitude: this.intervalPeak,
      rms: rms,
      rmsDbfs: rmsDbfs,
    };

    this.port.postMessage({
      type: 'PCM_CHUNK',
      buffer: chunk,
      metrics: metrics,
    }, [chunk]);

    this.outputIndex = 0;
    this.intervalTotal = 0;
    this.intervalClipped = 0;
    this.intervalZeros = 0;
    this.intervalPeak = 0;
    this.intervalSumSq = 0;
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
  const [matcherDiagnostics, setMatcherDiagnostics] = useState<MatchDiagnostics | null>(null);
  const [showDiagnosticsPanel, setShowDiagnosticsPanel] = useState<boolean>(false);

  // Audio Device Selection
  const [availableDevices, setAvailableDevices] = useState<AudioDeviceOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxDurationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagnosticsRef = useRef<StreamDiagnostics>(INITIAL_DIAGNOSTICS);
  const throttledUpdateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Enumerate audio input devices
  const refreshAudioDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs: AudioDeviceOption[] = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${index + 1}`,
        }));
      setAvailableDevices(audioInputs);
    } catch (e) {
      console.warn('[Amber Live] Could not enumerate audio input devices:', e);
    }
  }, []);

  useEffect(() => {
    refreshAudioDevices();
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', refreshAudioDevices);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', refreshAudioDevices);
      };
    }
  }, [refreshAudioDevices]);

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
    setMatcherDiagnostics(null);
    setSessionSummary(null);
    setInterimMessage('Listening to ambient audio...');
    setStreamStatus('Initializing Pipeline...');

    diagnosticsRef.current = {
      ...INITIAL_DIAGNOSTICS,
      microphoneState: 'requesting',
      webSocketState: 'CONNECTING',
    };
    setDiagnostics({ ...diagnosticsRef.current });

    // 1. Create AudioContext synchronously inside user click handler
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

    // 2. Request microphone permission with selected device constraint
    let mediaStream: MediaStream;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone access requires a secure HTTPS connection or localhost.');
      }

      const audioConstraints: MediaTrackConstraints = {
        channelCount: { ideal: 1 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };

      if (selectedDeviceId) {
        audioConstraints.deviceId = { exact: selectedDeviceId };
      }

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });

      streamRef.current = mediaStream;
      setStream(mediaStream);
      diagnosticsRef.current.microphoneState = 'active';

      // Refresh devices now that permissions have been granted (labels are now readable)
      refreshAudioDevices();

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
          friendlyError = 'Selected microphone does not satisfy requested audio constraints.';
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

      maxDurationTimeoutRef.current = setTimeout(() => {
        stopListening('Session Limit Reached (60s)');
      }, 60000);

      // 4. Build audio processing graph with Polyphase Anti-Aliased Resampler
      try {
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
          diagnosticsRef.current.audioContextState = audioCtx.state;
        }

        const source = audioCtx.createMediaStreamSource(mediaStream);
        const silentGain = audioCtx.createGain();
        silentGain.gain.setValueAtTime(0, audioCtx.currentTime);
        silentGain.connect(audioCtx.destination);

        let workletLoaded = false;
        let workletErrorDetail: string | null = null;

        // Try AudioWorklet first
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
            let buffer: ArrayBuffer | null = null;
            let metrics: ResamplerMetrics | null = null;

            if (event.data instanceof ArrayBuffer) {
              buffer = event.data;
              metrics = calculatePcmMetrics(buffer);
            } else if (event.data && event.data.type === 'PCM_CHUNK' && event.data.buffer instanceof ArrayBuffer) {
              buffer = event.data.buffer;
              metrics = event.data.metrics || (buffer ? calculatePcmMetrics(buffer) : null);
            }

            if (buffer && metrics) {
              diagnosticsRef.current.inputRms = metrics.rms;
              diagnosticsRef.current.rmsDbfs = metrics.rmsDbfs;
              diagnosticsRef.current.peakAmplitude = metrics.peakAmplitude;
              diagnosticsRef.current.clippedSamples += metrics.clippedSamples;
              diagnosticsRef.current.clippingPercentage = metrics.clippingPercentage;
              diagnosticsRef.current.zeroPercentage = metrics.zeroPercentage;

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

        // ScriptProcessorNode fallback with PolyphaseResampler
        if (!workletLoaded) {
          diagnosticsRef.current.pipelineMode = 'ScriptProcessor';
          diagnosticsRef.current.fallbackReason = workletErrorDetail || 'AudioWorklet unsupported';

          const resampler = new PolyphaseResampler(audioCtx.sampleRate, 11025, 2048);
          const scriptNode = audioCtx.createScriptProcessor(2048, 1, 1);
          scriptNodeRef.current = scriptNode;

          scriptNode.onaudioprocess = (e) => {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
            const inputData = e.inputBuffer.getChannelData(0);

            resampler.process(inputData, (chunk) => {
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(chunk);
                diagnosticsRef.current.chunksSent++;
                diagnosticsRef.current.bytesSent += chunk.byteLength;
                diagnosticsRef.current.lastSendTime = Date.now();
              }
            });

            const metrics = resampler.getMetricsAndReset();
            diagnosticsRef.current.inputRms = metrics.rms;
            diagnosticsRef.current.rmsDbfs = metrics.rmsDbfs;
            diagnosticsRef.current.peakAmplitude = metrics.peakAmplitude;
            diagnosticsRef.current.clippedSamples += metrics.clippedSamples;
            diagnosticsRef.current.clippingPercentage = metrics.clippingPercentage;
            diagnosticsRef.current.zeroPercentage = metrics.zeroPercentage;
          };

          source.connect(scriptNode);
          scriptNode.connect(silentGain);
        }

        // 5. Throttled UI status updates
        throttledUpdateTimerRef.current = setInterval(() => {
          setDiagnostics({ ...diagnosticsRef.current });

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

          if (data.diagnostics) {
            setMatcherDiagnostics(data.diagnostics as MatchDiagnostics);
          }

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

  const isClipping = diagnostics.clippingPercentage > 0.5 || diagnostics.peakAmplitude >= 0.99;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Title & Introduction */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Live Recognition
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Stream microphone audio in real-time with anti-aliased polyphase resampling to continuously match ambient music.
        </p>
      </div>

      {/* Control Chamber */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-5">
        {/* Device Selection & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
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

            {/* Microphone Device Picker */}
            {availableDevices.length > 0 && !isListening && (
              <div className="flex items-center gap-1.5 pt-1">
                <Sliders className="w-3.5 h-3.5 text-gray-400" />
                <select
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500 max-w-xs truncate"
                  title="Select input microphone device"
                >
                  <option value="">Default Microphone</option>
                  {availableDevices.map((dev) => (
                    <option key={dev.deviceId} value={dev.deviceId}>
                      {dev.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
            <span className="font-mono text-[11px] text-gray-400">11,025 Hz Polyphase Sinc / Mono 16-bit</span>
          </div>
          <WaveformVisualizer stream={stream} isActive={isListening} color={isClipping ? '#dc2626' : '#d97706'} height={80} />
        </div>

        {/* Input Clipping Warning Banner */}
        {isListening && isClipping && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2.5 text-red-800 text-xs">
            <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
            <div className="flex-1">
              <strong>Input Signal Clipping ({diagnostics.clippingPercentage.toFixed(1)}%):</strong> Peak amplitude has saturated the audio converter ({(diagnostics.peakAmplitude * 100).toFixed(0)}%). Lower your microphone input gain or move away from speakers to prevent distorted fingerprint hashes.
            </div>
          </div>
        )}

        {/* Streaming Diagnostics Status Bar */}
        {isListening && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-gray-100 text-xs">
            <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100 space-y-0.5">
              <div className="text-[10px] uppercase font-semibold text-gray-400 flex items-center gap-1">
                <Cpu className="w-3 h-3 text-gray-500" />
                <span>Resampler</span>
              </div>
              <div className="font-mono font-medium text-gray-800 truncate" title={diagnostics.pipelineMode}>
                {diagnostics.pipelineMode} (Sinc FIR)
              </div>
              <div className="text-[10px] text-gray-500 font-mono">
                {diagnostics.sampleRate ? `${diagnostics.sampleRate} Hz → 11,025 Hz` : '11,025 Hz'}
              </div>
            </div>

            <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100 space-y-0.5">
              <div className="text-[10px] uppercase font-semibold text-gray-400 flex items-center gap-1">
                <Activity className="w-3 h-3 text-amber-600" />
                <span>Signal Level</span>
              </div>
              <div className="font-mono font-medium text-gray-800">
                {diagnostics.inputRms < 0.0005 ? (
                  <span className="text-amber-600">Near-silent</span>
                ) : (
                  <span className={isClipping ? 'text-red-600 font-bold' : 'text-emerald-700'}>
                    {diagnostics.rmsDbfs} dBFS ({(diagnostics.inputRms * 100).toFixed(1)}%)
                  </span>
                )}
              </div>
              <div className="text-[10px] text-gray-500 font-mono">
                Peak: {(diagnostics.peakAmplitude * 100).toFixed(0)}% | Clip: {diagnostics.clippingPercentage.toFixed(1)}%
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
              <div className="text-[10px] text-gray-500 font-mono">
                {(diagnostics.bytesSent / 1024).toFixed(0)} KB | Zero: {diagnostics.zeroPercentage.toFixed(1)}%
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
              <div className="text-[10px] text-gray-500 font-mono">
                {diagnostics.evalLatencyMs ? `${diagnostics.evalLatencyMs.toFixed(0)}ms latency` : 'Awaiting 2s window'}
              </div>
            </div>
          </div>
        )}

        {/* Collapsible Developer Matching Diagnostics Panel */}
        {(isListening || matcherDiagnostics) && (
          <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-xs">
            <button
              onClick={() => setShowDiagnosticsPanel((prev) => !prev)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-xs font-semibold text-gray-700"
            >
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-amber-600" />
                <span>Developer Matching Diagnostics</span>
                {matcherDiagnostics && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                    matcherDiagnostics.rejectionGate === 'NONE'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}>
                    {matcherDiagnostics.rejectionGate === 'NONE' ? 'CONFIRMED' : matcherDiagnostics.rejectionGate}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-gray-500 text-[11px]">
                <span>{showDiagnosticsPanel ? 'Hide Details' : 'Show Details'}</span>
                {showDiagnosticsPanel ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>

            {showDiagnosticsPanel && (
              <div className="p-4 space-y-4 text-xs border-t border-gray-100 bg-gray-50/50">
                {matcherDiagnostics ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-white p-3 rounded-lg border border-gray-200 space-y-1">
                        <div className="text-[10px] uppercase font-bold text-gray-400">Query Features</div>
                        <div className="font-mono font-semibold text-gray-900">{matcherDiagnostics.queryFingerprints} FPs</div>
                        <div className="text-[10px] text-gray-500 font-mono">{matcherDiagnostics.distinctQueryHashes} distinct hashes</div>
                      </div>

                      <div className="bg-white p-3 rounded-lg border border-gray-200 space-y-1">
                        <div className="text-[10px] uppercase font-bold text-gray-400">Database Hits</div>
                        <div className="font-mono font-semibold text-gray-900">{matcherDiagnostics.candidateFingerprintRows} rows</div>
                        <div className="text-[10px] text-gray-500 font-mono">{matcherDiagnostics.candidateSongs} candidate songs</div>
                      </div>

                      <div className="bg-white p-3 rounded-lg border border-gray-200 space-y-1">
                        <div className="text-[10px] uppercase font-bold text-gray-400">Winning Candidate</div>
                        <div className="font-mono font-semibold text-gray-900 truncate" title={matcherDiagnostics.winningSongTitle || undefined}>
                          {matcherDiagnostics.winningSongTitle ? (
                            <span>{matcherDiagnostics.winningSongTitle}</span>
                          ) : matcherDiagnostics.winningSongId != null ? (
                            `Song ID #${matcherDiagnostics.winningSongId}`
                          ) : (
                            'None'
                          )}
                        </div>
                        <div className="text-[10px] text-gray-500 font-mono truncate">
                          {matcherDiagnostics.winningSongArtist ? `${matcherDiagnostics.winningSongArtist} • ` : ''}
                          Score: {matcherDiagnostics.winningScore.toFixed(1)} | Offset: {matcherDiagnostics.estimatedOffsetMs}ms
                        </div>
                      </div>

                      <div className="bg-white p-3 rounded-lg border border-gray-200 space-y-1">
                        <div className="text-[10px] uppercase font-bold text-gray-400">Coherence Metrics</div>
                        <div className="font-mono font-semibold text-gray-900">
                          CR: {(matcherDiagnostics.coherenceRatio * 100).toFixed(2)}%
                        </div>
                        <div className="text-[10px] text-gray-500 font-mono">
                          Peak: {matcherDiagnostics.winningPeakVotes} / Distinct: {matcherDiagnostics.totalWinningVotes}
                          {matcherDiagnostics.rawPairwiseVotes != null && (
                            <span className="text-gray-400 block text-[9px]">
                              Raw Pairwise: {matcherDiagnostics.rawPairwiseVotes}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-white p-3 rounded-lg border border-gray-200 space-y-1.5">
                        <div className="text-[10px] uppercase font-bold text-gray-400">Ranking & Separation</div>
                        <div className="flex justify-between text-[11px] font-mono">
                          <span className="text-gray-500">Winner Score:</span>
                          <span className="font-semibold text-gray-900">{matcherDiagnostics.winningScore.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between text-[11px] font-mono">
                          <span className="text-gray-500">Runner-Up Score:</span>
                          <span className="font-semibold text-gray-900">{matcherDiagnostics.runnerUpScore.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between text-[11px] font-mono">
                          <span className="text-gray-500">Separation Margin:</span>
                          <span className="font-semibold text-gray-900">{(matcherDiagnostics.margin * 100).toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between text-[11px] font-mono">
                          <span className="text-gray-500">Matcher Latency:</span>
                          <span className="font-semibold text-gray-900">{matcherDiagnostics.searchDurationMs.toFixed(1)} ms</span>
                        </div>
                      </div>

                      <div className="bg-white p-3 rounded-lg border border-gray-200 space-y-1.5">
                        <div className="text-[10px] uppercase font-bold text-gray-400">Rejection Decision</div>
                        <div className="text-xs font-semibold text-gray-900 flex items-center gap-1.5">
                          <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-800">
                            {matcherDiagnostics.rejectionGate}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-600 leading-relaxed">
                          {matcherDiagnostics.rejectionReason}
                        </p>
                        {matcherDiagnostics.rejectionGate !== 'NONE' && matcherDiagnostics.winningSongTitle && (
                          <div className="text-[10px] text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-200">
                            <span className="font-semibold">Leading candidate:</span> {matcherDiagnostics.winningSongTitle}
                            {matcherDiagnostics.winningSongArtist ? ` by ${matcherDiagnostics.winningSongArtist}` : ''}
                          </div>
                        )}
                      </div>
                    </div>

                    {matcherDiagnostics.topBuckets && matcherDiagnostics.topBuckets.length > 0 && (
                      <div className="bg-white p-3 rounded-lg border border-gray-200 space-y-2">
                        <div className="text-[10px] uppercase font-bold text-gray-400">Top 15 Offset Histogram Buckets</div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-[11px] font-mono text-left">
                            <thead className="bg-gray-50 text-gray-500 text-[10px]">
                              <tr>
                                <th className="py-1 px-2">Offset (ms)</th>
                                <th className="py-1 px-2">Offset (sec)</th>
                                <th className="py-1 px-2">Votes</th>
                                <th className="py-1 px-2">Prominence</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {matcherDiagnostics.topBuckets.slice(0, 15).map((bucket, i) => (
                                <tr key={i} className={i === 0 ? 'bg-amber-50/50 font-semibold text-amber-900' : 'text-gray-700'}>
                                  <td className="py-1 px-2">{bucket.offsetMs} ms</td>
                                  <td className="py-1 px-2">{(bucket.offsetMs / 1000).toFixed(2)} s</td>
                                  <td className="py-1 px-2">{bucket.votes}</td>
                                  <td className="py-1 px-2">
                                    <div className="w-24 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                      <div
                                        className={`h-full ${i === 0 ? 'bg-amber-500' : 'bg-gray-400'}`}
                                        style={{ width: `${Math.min(100, (bucket.votes / Math.max(1, matcherDiagnostics.winningPeakVotes)) * 100)}%` }}
                                      />
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-gray-500 text-center py-2 italic font-mono text-[11px]">
                    Waiting for initial audio evaluation window...
                  </p>
                )}
              </div>
            )}
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
