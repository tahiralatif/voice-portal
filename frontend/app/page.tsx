"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type Stage = "idle" | "listening" | "transcribing" | "speaking" | "paused";
type Tab = "stt" | "tts";

interface Voice {
  code: string;
  name: string;
  voice: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  language?: string;
  timestamp: number;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("stt");
  const [stage, setStage] = useState<Stage>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [sessionId] = useState(() => crypto.randomUUID());
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState("auto");
  const [wsConnected, setWsConnected] = useState(false);
  const [streamingText, setStreamingText] = useState("");

  // STT
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [transcript, setTranscript] = useState("");

  // TTS
  const [ttsText, setTtsText] = useState("");
  const [ttsLanguage, setTtsLanguage] = useState("en");
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [ttsLatency, setTtsLatency] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chunkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimer = useRef<NodeJS.Timeout | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const stageRef = useRef<Stage>("idle");

  useEffect(() => { stageRef.current = stage; }, [stage]);

  useEffect(() => {
    fetch("/api/languages").then(r => r.json()).then(d => setVoices(d.voices || [])).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  useEffect(() => {
    if (isRecording) {
      recordingTimerRef.current = setInterval(() => setRecordingTime(p => p + 1), 1000);
    } else {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
    return () => { if (recordingTimerRef.current) clearInterval(recordingTimerRef.current); };
  }, [isRecording]);

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // Waveform
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bufLen = analyser.frequencyBinCount;
    const data = new Uint8Array(bufLen);
    analyser.getByteTimeDomainData(data);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#7c3aed";
    ctx.beginPath();
    const slice = canvas.width / bufLen;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const y = (data[i] / 128.0) * canvas.height / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += slice;
    }
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
    animFrameRef.current = requestAnimationFrame(drawWaveform);
  }, []);

  // WebSocket — NO dependencies except sessionId (stable)
  useEffect(() => {
    let alive = true;
    const connect = () => {
      if (!alive) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/${sessionId}`);
      wsRef.current = ws;

      ws.onopen = () => { if (alive) setWsConnected(true); };
      ws.onclose = () => {
        if (!alive) return;
        setWsConnected(false);
        reconnectTimer.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => {};

      ws.onmessage = (event) => {
        const d = JSON.parse(event.data);
        switch (d.type) {
          case "status":
            if (d.stage === "transcribing") setStage("transcribing");
            if (d.stage === "speaking") setStage("speaking");
            if (d.stage === "error") { setError(d.message || "Error"); setStage("idle"); setIsRecording(false); }
            break;
          case "interim_transcript":
            if (stageRef.current === "listening") setStreamingText(d.text || "");
            break;
          case "transcript":
            setTranscript(d.text);
            setMessages(prev => [...prev, { id: crypto.randomUUID(), role: "user", text: d.text, language: d.language, timestamp: Date.now() }]);
            setStreamingText("");
            setIsRecording(false);
            setRecordingTime(0);
            break;
          case "audio_reply": {
            // Play audio inline — no callback dependency
            try {
              const bin = atob(d.audio);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              const blob = new Blob([bytes], { type: "audio/mpeg" });
              const url = URL.createObjectURL(blob);
              setTtsAudioUrl(url);
              setTtsLatency(Math.round(d.total_latency_ms || 0));
            } catch (e) { console.error("Audio error:", e); }
            setMessages(prev => [...prev, { id: crypto.randomUUID(), role: "assistant", text: "🔊 Audio played", timestamp: Date.now() }]);
            setStage("idle");
            break;
          }
          case "interaction_complete":
            setStage("idle");
            break;
        }
      };
    };
    connect();
    return () => {
      alive = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [sessionId]); // sessionId is stable, so this runs once

  const startRecording = async () => {
    setError(""); setStreamingText(""); setTranscript(""); setRecordingTime(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 } });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;
      drawWaveform();

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm",
      });
      chunksRef.current = [];
      chunkIntervalRef.current = setInterval(() => {
        if (recorder.state === "recording" && chunksRef.current.length > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          const r = new FileReader();
          r.onloadend = () => {
            const b64 = (r.result as string).split(",")[1];
            if (b64 && wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "chunk", audio: b64 }));
          };
          r.readAsDataURL(blob);
        }
      }, 1000);

      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        if (chunkIntervalRef.current) { clearInterval(chunkIntervalRef.current); chunkIntervalRef.current = null; }
        stream.getTracks().forEach(t => t.stop());
        cancelAnimationFrame(animFrameRef.current);
        // Send final audio
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const r = new FileReader();
        r.onloadend = () => {
          const b64 = (r.result as string).split(",")[1];
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            const stopMsg: Record<string, any> = { type: "stop_streaming" };
            if (selectedLanguage !== "auto") stopMsg.language = selectedLanguage;
            wsRef.current.send(JSON.stringify(stopMsg));
            const msg: Record<string, any> = { type: "audio", engine: "local", audio: b64 };
            if (selectedLanguage !== "auto") msg.language = selectedLanguage;
            wsRef.current.send(JSON.stringify(msg));
          }
        };
        r.readAsDataURL(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000);
      setStage("listening");
      setIsRecording(true);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const msg: Record<string, any> = { type: "start_streaming" };
        if (selectedLanguage !== "auto") msg.language = selectedLanguage;
        wsRef.current.send(JSON.stringify(msg));
      }
    } catch { setError("Microphone access denied."); setStage("idle"); }
  };

  const stopRecording = () => { mediaRecorderRef.current?.stop(); setIsRecording(false); };
  const pauseRecording = () => { if (mediaRecorderRef.current?.state === "recording") { mediaRecorderRef.current.pause(); setStage("paused"); } };
  const resumeRecording = () => { if (mediaRecorderRef.current?.state === "paused") { mediaRecorderRef.current.resume(); setStage("listening"); } };

  const sendTTS = () => {
    if (!ttsText.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setStage("speaking"); setError("");
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: "user", text: ttsText, timestamp: Date.now() }]);
    wsRef.current.send(JSON.stringify({ type: "text", text: ttsText, language: ttsLanguage }));
    setTtsText("");
  };

  const copyText = async (text: string) => { try { await navigator.clipboard.writeText(text); } catch {} };
  const downloadTranscript = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([transcript], { type: "text/plain" }));
    a.download = `transcript-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
  };
  const clearTranscript = () => { setTranscript(""); setMessages([]); setStreamingText(""); };
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTTS(); } };

  const isProcessing = stage === "transcribing" || stage === "speaking";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-violet-50/30">
      <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200/60 px-6 py-4 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                <line x1="12" y1="19" x2="12" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                <line x1="8" y1="23" x2="16" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Voice Portal</h1>
              <p className="text-[10px] text-slate-400 tracking-wider uppercase">Multilingual Voice Engine</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-100 rounded-xl p-1">
              <button onClick={() => setActiveTab("stt")} className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === "stt" ? "bg-white text-violet-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>🎤 Speech to Text</button>
              <button onClick={() => setActiveTab("tts")} className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === "tts" ? "bg-white text-violet-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>🔊 Text to Speech</button>
            </div>
            <a href="/analytics" className="text-slate-400 hover:text-violet-600 transition p-2 rounded-lg hover:bg-slate-100">📊</a>
            <div className={`w-2 h-2 rounded-full ${wsConnected ? "bg-emerald-500" : "bg-red-500 animate-pulse"}`} />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {activeTab === "stt" ? (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200/60 p-8">
              <div className="bg-gradient-to-br from-slate-50 to-violet-50/50 rounded-2xl p-4 mb-6">
                <canvas ref={canvasRef} width={800} height={100} className="w-full h-24 rounded-xl" />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button onClick={isRecording ? stopRecording : startRecording} disabled={isProcessing}
                    className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300 ${isRecording ? "bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30 scale-105" : "bg-gradient-to-br from-violet-600 to-indigo-600 hover:shadow-lg hover:shadow-violet-500/30 hover:scale-105"} disabled:opacity-50`}>
                    <span className="text-2xl">{isRecording ? "⏹" : "🎤"}</span>
                  </button>
                  {isRecording && (
                    <button onClick={stage === "paused" ? resumeRecording : pauseRecording}
                      className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-all">
                      <span className="text-lg">{stage === "paused" ? "▶️" : "⏸️"}</span>
                    </button>
                  )}
                  <div>
                    <p className="text-sm font-medium text-slate-700">{isRecording ? (stage === "paused" ? "Paused" : "Recording...") : "Tap to start recording"}</p>
                    <p className="text-xs text-slate-400">{isRecording ? formatTime(recordingTime) : "Speak in any language"}</p>
                  </div>
                </div>
                <select value={selectedLanguage} onChange={(e) => setSelectedLanguage(e.target.value)}
                  className="bg-slate-100 border-none rounded-xl px-4 py-2.5 text-sm text-slate-600 outline-none cursor-pointer hover:bg-slate-200 transition">
                  <option value="auto">🔍 Auto-detect</option>
                  {voices.map(v => <option key={v.code} value={v.code}>{v.name}</option>)}
                </select>
              </div>
            </div>

            {streamingText && (
              <div className="bg-white rounded-2xl shadow-lg shadow-slate-200/50 border border-slate-200/60 p-6">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 bg-violet-500 rounded-full animate-pulse" />
                  <span className="text-xs font-medium text-violet-600 uppercase tracking-wider">Live Transcription</span>
                </div>
                <p className="text-slate-700 text-lg leading-relaxed">{streamingText}<span className="inline-block w-0.5 h-5 bg-violet-500 ml-1 animate-pulse align-middle" /></p>
              </div>
            )}

            {transcript && (
              <div className="bg-white rounded-2xl shadow-lg shadow-slate-200/50 border border-slate-200/60 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                    <span className="text-xs font-medium text-emerald-600 uppercase tracking-wider">Transcript</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => copyText(transcript)} className="px-3 py-1.5 text-xs text-slate-500 hover:text-violet-600 bg-slate-100 hover:bg-violet-50 rounded-lg transition">📋 Copy</button>
                    <button onClick={downloadTranscript} className="px-3 py-1.5 text-xs text-slate-500 hover:text-violet-600 bg-slate-100 hover:bg-violet-50 rounded-lg transition">⬇️ Download</button>
                    <button onClick={clearTranscript} className="px-3 py-1.5 text-xs text-slate-500 hover:text-red-600 bg-slate-100 hover:bg-red-50 rounded-lg transition">🗑️ Clear</button>
                  </div>
                </div>
                <p className="text-slate-800 text-lg leading-relaxed">{transcript}</p>
              </div>
            )}

            {error && <div className="bg-red-50 border border-red-200 text-red-600 rounded-2xl px-5 py-3 text-sm text-center">{error}</div>}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200/60 p-8">
              <h2 className="text-lg font-bold text-slate-900 mb-6">Generate Speech</h2>
              <div className="mb-6">
                <textarea value={ttsText} onChange={(e) => setTtsText(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder="Type or paste text to convert to speech..."
                  className="w-full h-32 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-slate-800 placeholder-slate-400 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition resize-none" />
              </div>
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <label className="text-sm font-medium text-slate-700 mb-2 block">Voice</label>
                  <select value={ttsLanguage} onChange={(e) => setTtsLanguage(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 outline-none focus:border-violet-500 transition cursor-pointer">
                    {voices.map(v => <option key={v.code} value={v.code}>{v.name}</option>)}
                  </select>
                </div>
                <button onClick={sendTTS} disabled={!ttsText.trim() || isProcessing}
                  className="h-12 px-8 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-medium rounded-xl transition-all duration-200 shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {isProcessing ? (<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Generating...</>) : (<>🔊 Generate Speech</>)}
                </button>
              </div>
            </div>

            {ttsAudioUrl && (
              <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200/60 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-slate-900">Audio Preview</h3>
                  {ttsLatency > 0 && <span className="text-xs text-slate-400">Generated in {ttsLatency}ms</span>}
                </div>
                <audio ref={audioRef} src={ttsAudioUrl}
                  onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)}
                  onTimeUpdate={(e) => setAudioProgress((e.target as HTMLAudioElement).currentTime)}
                  onLoadedMetadata={(e) => setAudioDuration((e.target as HTMLAudioElement).duration)}
                  className="hidden" />
                <div className="bg-gradient-to-br from-slate-50 to-violet-50/50 rounded-2xl p-4 mb-4">
                  <div className="h-16 flex items-center justify-center gap-[2px]">
                    {Array.from({ length: 50 }).map((_, i) => (
                      <div key={i} className="w-1 bg-gradient-to-t from-violet-500 to-indigo-500 rounded-full transition-all duration-150"
                        style={{ height: `${20 + Math.random() * 80}%`, opacity: audioDuration > 0 && (audioProgress / audioDuration) * 50 > i ? 1 : 0.3 }} />
                    ))}
                  </div>
                </div>
                <div className="mb-4">
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-100"
                      style={{ width: `${audioDuration ? (audioProgress / audioDuration) * 100 : 0}%` }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                    <span>{formatTime(Math.floor(audioProgress))}</span><span>{formatTime(Math.floor(audioDuration))}</span>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-3">
                  <button onClick={() => { const a = audioRef.current; if (a) a.currentTime = Math.max(0, a.currentTime - 10); }} className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition">⏪</button>
                  <button onClick={() => { const a = audioRef.current; if (a) isPlaying ? a.pause() : a.play(); }} className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 hover:shadow-lg hover:shadow-violet-500/30 flex items-center justify-center transition-all text-white text-xl">{isPlaying ? "⏸️" : "▶️"}</button>
                  <button onClick={() => { const a = audioRef.current; if (a) a.currentTime = Math.min(a.duration, a.currentTime + 10); }} className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition">⏩</button>
                </div>
                <div className="flex items-center justify-center gap-2 mt-4">
                  <a href={ttsAudioUrl} download="speech.mp3" className="px-4 py-2 text-xs text-slate-600 hover:text-violet-600 bg-slate-100 hover:bg-violet-50 rounded-xl transition flex items-center gap-1">⬇️ Download</a>
                  <button onClick={() => navigator.clipboard.writeText(window.location.origin + ttsAudioUrl)} className="px-4 py-2 text-xs text-slate-600 hover:text-violet-600 bg-slate-100 hover:bg-violet-50 rounded-xl transition flex items-center gap-1">🔗 Copy Link</button>
                </div>
              </div>
            )}
            {error && <div className="bg-red-50 border border-red-200 text-red-600 rounded-2xl px-5 py-3 text-sm text-center">{error}</div>}
          </div>
        )}
      </main>

      <footer className="text-center py-6 text-xs text-slate-400">Powered by faster-whisper + Edge TTS • No API keys required</footer>
    </div>
  );
}
