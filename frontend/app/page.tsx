"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type Stage = "idle" | "listening" | "transcribing" | "speaking";

interface Voice {
  code: string;
  name: string;
  voice: string;
}

export default function Home() {
  const [stage, setStage] = useState<Stage>("idle");
  const [transcript, setTranscript] = useState("");
  const [language, setLanguage] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState("auto");
  const [ttsText, setTtsText] = useState("");
  const [ttsLanguage, setTtsLanguage] = useState("en");
  const [wsConnected, setWsConnected] = useState(false);
  const [streamingTranscript, setStreamingTranscript] = useState("");
  const [latency, setLatency] = useState<{ stt: number; tts: number; total: number }>({
    stt: 0, tts: 0, total: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chunkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const reconnectTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetch("/api/languages").then(r => r.json()).then(d => setVoices(d.voices || [])).catch(() => {});
  }, []);

  const playAudio = useCallback((b64: string) => {
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); setStage("idle"); };
      audio.onerror = () => { URL.revokeObjectURL(url); setStage("idle"); };
      audio.play();
    } catch (e) {
      console.error("Audio play error:", e);
      setStage("idle");
    }
  }, []);

  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/${sessionId}`);

    ws.onopen = () => { console.log("[WS] Connected"); setWsConnected(true); };
    ws.onclose = () => { setWsConnected(false); reconnectTimer.current = setTimeout(connectWs, 3000); };
    ws.onerror = () => {};

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "status":
          if (data.stage === "transcribing") setStage("transcribing");
          if (data.stage === "speaking") setStage("speaking");
          if (data.stage === "error") { setError(data.message || "Error"); setStage("idle"); }
          break;
        case "interim_transcript":
          if (stage === "listening") {
            setStreamingTranscript(data.text || "");
          }
          break;
        case "transcript":
          setTranscript(data.text);
          setLanguage(data.language);
          setStreamingTranscript("");
          setLatency((prev) => ({ ...prev, stt: Math.round(data.latency_ms) }));
          break;
        case "audio_reply":
          setLatency((prev) => ({
            ...prev,
            tts: Math.round(data.latency_ms),
            total: Math.round(data.total_latency_ms),
          }));
          playAudio(data.audio);
          break;
        case "interaction_complete":
          setStage("idle");
          break;
      }
    };

    wsRef.current = ws;
  }, [sessionId, playAudio]);

  useEffect(() => {
    connectWs();
    return () => { if (reconnectTimer.current) clearTimeout(reconnectTimer.current); wsRef.current?.close(); };
  }, [connectWs]);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = stage === "listening" ? "#00CEC9" : "#6C5CE7";
    ctx.beginPath();
    const sliceWidth = canvas.width / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
    animFrameRef.current = requestAnimationFrame(drawWaveform);
  }, [stage]);

  const startRecording = async () => {
    setError("");
    setTranscript("");
    setStreamingTranscript("");
    setLatency({ stt: 0, tts: 0, total: 0 });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;
      drawWaveform();

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus" : "audio/webm",
      });

      chunksRef.current = [];

      // Stream audio chunks every 1s while recording for live transcription
      chunkIntervalRef.current = setInterval(() => {
        if (recorder.state === "recording" && chunksRef.current.length > 0 &&
            wsRef.current?.readyState === WebSocket.OPEN) {
          const partialBlob = new Blob(chunksRef.current, { type: "audio/webm" });
          const reader = new FileReader();
          reader.onloadend = () => {
            const b64 = (reader.result as string).split(",")[1];
            if (b64 && wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: "chunk", audio: b64 }));
            }
          };
          reader.readAsDataURL(partialBlob);
        }
      }, 1000);

      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        // Stop streaming chunks
        if (chunkIntervalRef.current) {
          clearInterval(chunkIntervalRef.current);
          chunkIntervalRef.current = null;
        }
        stream.getTracks().forEach((t) => t.stop());
        cancelAnimationFrame(animFrameRef.current);
        sendAudio();
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000); // timeslice=1000ms: fires ondataavailable every 1s for streaming
      setStage("listening");

      // Notify backend that streaming is starting (sends language override for interim STT)
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const msg: Record<string, any> = { type: "start_streaming" };
        if (selectedLanguage !== "auto") msg.language = selectedLanguage;
        wsRef.current.send(JSON.stringify(msg));
      }
    } catch {
      setError("Microphone access denied.");
      setStage("idle");
    }
  };

  const stopRecording = () => mediaRecorderRef.current?.stop();

  const sendAudio = () => {
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    const reader = new FileReader();
    reader.onloadend = () => {
      const b64 = (reader.result as string).split(",")[1];
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        // Signal end of streaming (sends language override for final STT context)
        const stopMsg: Record<string, any> = { type: "stop_streaming" };
        if (selectedLanguage !== "auto") stopMsg.language = selectedLanguage;
        wsRef.current.send(JSON.stringify(stopMsg));

        // Send final complete audio for full STT
        const msg: Record<string, any> = { type: "audio", engine: "local", audio: b64 };
        if (selectedLanguage !== "auto") msg.language = selectedLanguage;
        wsRef.current.send(JSON.stringify(msg));
      }
    };
    reader.readAsDataURL(blob);
  };

  const toggleMic = () => {
    if (stage === "listening") stopRecording();
    else if (stage === "idle") startRecording();
  };

  const sendTTS = () => {
    if (!ttsText.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setStage("speaking");
    setError("");
    setLatency({ stt: 0, tts: 0, total: 0 });
    wsRef.current.send(JSON.stringify({ type: "text", text: ttsText, language: ttsLanguage }));
  };

  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const stageLabel: Record<Stage, string> = {
    idle: "Tap to speak",
    listening: "Listening...",
    transcribing: "Transcribing...",
    speaking: "Speaking...",
  };

  const isProcessing = stage === "transcribing" || stage === "speaking";

  return (
    <div className="min-h-screen bg-[#0A0A1A] text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-teal-500 flex items-center justify-center">
            <span className="text-lg">🎙️</span>
          </div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-teal-400 bg-clip-text text-transparent">
            Voice Portal
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <a href="/analytics" className="text-sm text-gray-400 hover:text-white transition px-3 py-1.5 rounded-lg hover:bg-white/5">
            📊 Analytics
          </a>
          <div className={`w-2 h-2 rounded-full ${wsConnected ? "bg-green-500" : "bg-red-500 animate-pulse"}`} />
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center px-4 py-8 gap-6 max-w-2xl mx-auto w-full">
        {/* Language Selector */}
        <div className="bg-[#151528] border border-white/10 rounded-full px-3 py-1.5">
          <select value={selectedLanguage} onChange={(e) => setSelectedLanguage(e.target.value)}
            className="bg-transparent text-xs text-gray-300 outline-none cursor-pointer">
            <option value="auto" className="bg-[#151528]">🔍 Auto-detect</option>
            {voices.map((v) => (
              <option key={v.code} value={v.code} className="bg-[#151528]">{v.name}</option>
            ))}
          </select>
        </div>
        <p className="text-[10px] text-gray-600 -mt-3">Urdu ke liye "Urdu" select karein — Auto-detect Hindi pick karta hai</p>

        {/* Section 1: STT — Speak → Text */}
        <div className="w-full bg-[#151528] border border-white/10 rounded-xl p-5">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">🗣 Speak → Text</p>
          <canvas ref={canvasRef} width={600} height={80}
            className="w-full h-[80px] rounded-lg bg-[#0A0A1A] border border-white/5 mb-3" />
          <div className="flex items-center gap-3">
            <button onClick={toggleMic} disabled={isProcessing}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 shrink-0 ${
                stage === "listening"
                  ? "bg-red-500 shadow-[0_0_30px_rgba(239,68,68,0.5)] scale-110 animate-pulse"
                  : isProcessing
                    ? "bg-yellow-500/60"
                    : "bg-gradient-to-br from-purple-500 to-teal-500 hover:scale-105 shadow-[0_0_20px_rgba(108,92,231,0.4)]"
              } disabled:opacity-50`}>
              <span className="text-xl">{stage === "listening" ? "⏹" : isProcessing ? "⏳" : "🎤"}</span>
            </button>
            <p className="text-xs text-gray-400">{stageLabel[stage]}</p>
          </div>

          {transcript && (
            <div className="mt-3 bg-[#0A0A1A] border border-white/5 rounded-lg p-3 relative group">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] text-gray-500 uppercase">{language?.toUpperCase()} · {latency.stt}ms</p>
                <button onClick={() => copyText(transcript)}
                  className="text-[10px] text-gray-500 hover:text-white px-2 py-0.5 rounded bg-white/5 opacity-0 group-hover:opacity-100 transition">
                  {copied ? "✓" : "📋 Copy"}
                </button>
              </div>
              <p className="text-white text-sm select-all">{transcript}</p>
            </div>
          )}

          {/* Streaming transcript — live preview while still speaking */}
          {!transcript && streamingTranscript && stage === "listening" && (
            <div className="mt-3 bg-[#0A0A1A] border border-teal-500/20 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                <p className="text-[10px] text-teal-400/70 uppercase tracking-wider">Live transcription</p>
              </div>
              <p className="text-teal-300/80 text-sm italic">{streamingTranscript}</p>
            </div>
          )}
        </div>

        {/* Section 2: TTS — Text → Voice */}
        <div className="w-full bg-[#151528] border border-white/10 rounded-xl p-5">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">🔊 Text → Voice</p>
          <div className="flex gap-2 mb-3">
            <select value={ttsLanguage} onChange={(e) => setTtsLanguage(e.target.value)}
              className="bg-[#0A0A1A] border border-white/5 rounded-lg px-3 py-2 text-xs text-gray-300 outline-none shrink-0">
              {voices.map((v) => (
                <option key={v.code} value={v.code} className="bg-[#0A0A1A]">{v.name}</option>
              ))}
            </select>
            <input type="text" value={ttsText} onChange={(e) => setTtsText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendTTS()}
              placeholder="Type text to hear it spoken..."
              className="flex-1 bg-[#0A0A1A] border border-white/5 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-purple-500/50 transition" />
            <button onClick={sendTTS} disabled={!ttsText.trim() || isProcessing}
              className="bg-gradient-to-r from-purple-500 to-teal-500 hover:scale-105 disabled:opacity-40 transition-all px-4 py-2 rounded-lg text-sm font-medium shrink-0">
              🔊 Play
            </button>
          </div>
          {latency.tts > 0 && (
            <p className="text-[10px] text-gray-500">TTS: {latency.tts}ms · {latency.total}ms total</p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-red-500/20 border border-red-500/30 rounded-lg text-red-300 text-xs text-center w-full">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
