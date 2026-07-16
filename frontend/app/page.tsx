"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type Stage = "idle" | "listening" | "transcribing" | "speaking";
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
  const [ttsText, setTtsText] = useState("");
  const [ttsLanguage, setTtsLanguage] = useState("en");
  const [wsConnected, setWsConnected] = useState(false);
  const [streamingText, setStreamingText] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chunkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimer = useRef<NodeJS.Timeout | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/languages").then(r => r.json()).then(d => setVoices(d.voices || [])).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [ttsText]);

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

    ws.onopen = () => { setWsConnected(true); };
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
          if (stage === "listening") setStreamingText(data.text || "");
          break;
        case "transcript":
          setMessages(prev => {
            const withoutStreaming = prev.filter(m => !(m as any).isStreaming);
            return [...withoutStreaming, {
              id: crypto.randomUUID(),
              role: "user",
              text: data.text,
              language: data.language,
              timestamp: Date.now(),
            }];
          });
          setStreamingText("");
          break;
        case "audio_reply":
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role: "assistant",
            text: "🔊 Audio played",
            timestamp: Date.now(),
          }]);
          playAudio(data.audio);
          break;
        case "interaction_complete":
          setStage("idle");
          break;
      }
    };

    wsRef.current = ws;
  }, [sessionId, playAudio, stage]);

  useEffect(() => {
    connectWs();
    return () => { if (reconnectTimer.current) clearTimeout(reconnectTimer.current); wsRef.current?.close(); };
  }, [connectWs]);

  const startRecording = async () => {
    setError("");
    setStreamingText("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus" : "audio/webm",
      });

      chunksRef.current = [];

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
        if (chunkIntervalRef.current) {
          clearInterval(chunkIntervalRef.current);
          chunkIntervalRef.current = null;
        }
        stream.getTracks().forEach((t) => t.stop());
        sendAudio();
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000);
      setStage("listening");

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
        const stopMsg: Record<string, any> = { type: "stop_streaming" };
        if (selectedLanguage !== "auto") stopMsg.language = selectedLanguage;
        wsRef.current.send(JSON.stringify(stopMsg));

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
    wsRef.current.send(JSON.stringify({ type: "text", text: ttsText, language: ttsLanguage }));

    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      role: "user",
      text: ttsText,
      timestamp: Date.now(),
    }]);

    setTtsText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendTTS();
    }
  };

  const isProcessing = stage === "transcribing" || stage === "speaking";

  return (
    <div className="h-screen bg-[#0c0c0c] text-white flex flex-col font-sans">
      {/* Header */}
      <header className="bg-[#141414] border-b border-amber-500/20 px-5 py-3 flex items-center justify-between shrink-0 shadow-lg shadow-black/50">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0c0c0c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-[#141414]" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">
              <span className="text-amber-400">Voice</span>
              <span className="text-white/80">Portal</span>
            </h1>
            <p className="text-[10px] text-white/30 tracking-widest uppercase">Multilingual Voice Engine</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a href="/analytics" className="text-xs text-white/40 hover:text-amber-400 transition px-2 py-1 rounded-lg hover:bg-white/5">
            📊
          </a>
          <div className={`w-2 h-2 rounded-full ${wsConnected ? "bg-green-500 shadow-lg shadow-green-500/50" : "bg-red-500 animate-pulse"}`} />
        </div>
      </header>

      {/* Tab Switcher */}
      <div className="bg-[#141414] border-b border-white/5 px-5 shrink-0">
        <div className="max-w-2xl mx-auto flex gap-1">
          <button onClick={() => setActiveTab("stt")}
            className={`flex-1 py-3 text-sm font-medium rounded-t-lg transition-all duration-200 ${
              activeTab === "stt"
                ? "bg-[#1a1a1a] text-amber-400 border-b-2 border-amber-400 shadow-lg shadow-amber-500/10"
                : "text-white/40 hover:text-white/60 hover:bg-white/5"
            }`}>
            <span className="mr-2">🎤</span>Speech → Text
          </button>
          <button onClick={() => setActiveTab("tts")}
            className={`flex-1 py-3 text-sm font-medium rounded-t-lg transition-all duration-200 ${
              activeTab === "tts"
                ? "bg-[#1a1a1a] text-amber-400 border-b-2 border-amber-400 shadow-lg shadow-amber-500/10"
                : "text-white/40 hover:text-white/60 hover:bg-white/5"
            }`}>
            <span className="mr-2">🔊</span>Text → Speech
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === "stt" ? (
          /* STT Tab */
          <>
            <div className="flex-1 overflow-y-auto px-4 py-6">
              <div className="max-w-2xl mx-auto space-y-4">
                {/* Language Selector */}
                <div className="flex items-center gap-2 mb-4">
                  <select value={selectedLanguage} onChange={(e) => setSelectedLanguage(e.target.value)}
                    className="bg-[#1a1a1a] border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-white/70 outline-none cursor-pointer hover:border-amber-500/40 transition">
                    <option value="auto">🔍 Auto-detect</option>
                    {voices.map((v) => (
                      <option key={v.code} value={v.code}>{v.name}</option>
                    ))}
                  </select>
                  <span className="text-[10px] text-white/30">Urdu ke liye select karein</span>
                </div>

                {messages.length === 0 && !streamingText && (
                  <div className="text-center py-16">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 flex items-center justify-center mx-auto mb-5 shadow-2xl shadow-amber-500/20">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0c0c0c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                    </div>
                    <h2 className="text-lg font-bold text-white mb-2">Speech to Text</h2>
                    <p className="text-sm text-white/40">Tap the mic and start speaking</p>
                    <p className="text-xs text-white/25 mt-1">Real-time transcription in 99 languages</p>
                  </div>
                )}

                {messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`flex gap-2 max-w-[80%] ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                        msg.role === "user"
                          ? "bg-gradient-to-br from-amber-400 to-amber-600 text-black shadow-lg shadow-amber-500/20"
                          : "bg-[#2a2a2a] text-white/60 border border-white/10"
                      }`}>
                        {msg.role === "user" ? "You" : "AI"}
                      </div>
                      <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        msg.role === "user"
                          ? "bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/20 text-white rounded-br-md shadow-lg shadow-amber-500/5"
                          : "bg-[#1a1a1a] border border-white/10 text-white/80 rounded-bl-md"
                      }`}>
                        {msg.text}
                        {msg.language && msg.role === "user" && (
                          <span className="ml-2 text-[10px] text-amber-400/50">{msg.language.toUpperCase()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {streamingText && (
                  <div className="flex justify-end">
                    <div className="flex gap-2 max-w-[80%] flex-row-reverse">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-black flex items-center justify-center shrink-0 text-xs font-bold shadow-lg shadow-amber-500/20">
                        You
                      </div>
                      <div className="bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/20 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed shadow-lg shadow-amber-500/5">
                        <span className="italic text-white/70">{streamingText}</span>
                        <span className="inline-block w-0.5 h-4 bg-amber-400 ml-1 animate-pulse" />
                      </div>
                    </div>
                  </div>
                )}

                {isProcessing && (
                  <div className="flex justify-start">
                    <div className="flex gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#2a2a2a] text-white/60 flex items-center justify-center shrink-0 text-xs font-bold border border-white/10">
                        AI
                      </div>
                      <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl rounded-bl-md px-4 py-3">
                        <div className="flex gap-1">
                          <div className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <div className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <div className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="flex justify-center">
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-2 text-xs">
                      {error}
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* STT Input Bar */}
            <div className="bg-[#141414] border-t border-amber-500/10 px-4 py-4 shrink-0">
              <div className="max-w-2xl mx-auto flex items-center justify-center gap-4">
                <button onClick={toggleMic} disabled={isProcessing}
                  className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 ${
                    stage === "listening"
                      ? "bg-red-500 shadow-[0_0_40px_rgba(239,68,68,0.4)] scale-110"
                      : isProcessing
                        ? "bg-amber-500/50"
                        : "bg-gradient-to-br from-amber-400 to-amber-600 hover:scale-105 shadow-[0_0_30px_rgba(245,158,11,0.3)]"
                  } disabled:opacity-50`}>
                  <span className="text-2xl">{stage === "listening" ? "⏹" : isProcessing ? "⏳" : "🎤"}</span>
                </button>
                <div className="text-left">
                  <p className="text-sm text-white/70 font-medium">
                    {stage === "listening" ? "Listening..." : isProcessing ? "Processing..." : "Tap to speak"}
                  </p>
                  <p className="text-[10px] text-white/30">
                    {stage === "listening" ? "Tap to stop recording" : "Hold mic or tap to start"}
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* TTS Tab */
          <>
            <div className="flex-1 overflow-y-auto px-4 py-6">
              <div className="max-w-2xl mx-auto space-y-4">
                {messages.length === 0 && (
                  <div className="text-center py-16">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 flex items-center justify-center mx-auto mb-5 shadow-2xl shadow-amber-500/20">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0c0c0c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                    </div>
                    <h2 className="text-lg font-bold text-white mb-2">Text to Speech</h2>
                    <p className="text-sm text-white/40">Type text and hear it spoken</p>
                    <p className="text-xs text-white/25 mt-1">400+ voices across 17 languages</p>
                  </div>
                )}

                {messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`flex gap-2 max-w-[80%] ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                        msg.role === "user"
                          ? "bg-gradient-to-br from-amber-400 to-amber-600 text-black shadow-lg shadow-amber-500/20"
                          : "bg-[#2a2a2a] text-white/60 border border-white/10"
                      }`}>
                        {msg.role === "user" ? "You" : "🔊"}
                      </div>
                      <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        msg.role === "user"
                          ? "bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/20 text-white rounded-br-md shadow-lg shadow-amber-500/5"
                          : "bg-[#1a1a1a] border border-white/10 text-white/80 rounded-bl-md"
                      }`}>
                        {msg.text}
                      </div>
                    </div>
                  </div>
                ))}

                {isProcessing && (
                  <div className="flex justify-start">
                    <div className="flex gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#2a2a2a] text-white/60 flex items-center justify-center shrink-0 text-xs border border-white/10">
                        🔊
                      </div>
                      <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl rounded-bl-md px-4 py-3">
                        <div className="flex gap-1">
                          <div className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <div className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <div className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="flex justify-center">
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-2 text-xs">
                      {error}
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* TTS Input Bar */}
            <div className="bg-[#141414] border-t border-amber-500/10 px-4 py-4 shrink-0">
              <div className="max-w-2xl mx-auto">
                <div className="flex items-end gap-2 bg-[#1a1a1a] border border-white/10 rounded-2xl px-3 py-2 focus-within:border-amber-500/30 transition">
                  <select value={ttsLanguage} onChange={(e) => setTtsLanguage(e.target.value)}
                    className="bg-[#0c0c0c] border border-white/10 rounded-lg px-2 py-2 text-xs text-white/60 outline-none shrink-0 mb-0.5">
                    {voices.map((v) => (
                      <option key={v.code} value={v.code}>{v.name}</option>
                    ))}
                  </select>
                  <textarea ref={textareaRef} value={ttsText} onChange={(e) => setTtsText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type text to hear it spoken..."
                    rows={1}
                    className="flex-1 bg-transparent text-sm text-white placeholder-white/30 outline-none resize-none py-2 max-h-[120px]"
                    disabled={isProcessing} />
                  <button onClick={sendTTS} disabled={!ttsText.trim() || isProcessing}
                    className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-black flex items-center justify-center shrink-0 mb-0.5 hover:shadow-lg hover:shadow-amber-500/30 transition disabled:opacity-30">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </svg>
                  </button>
                </div>
                <p className="text-[10px] text-white/20 text-center mt-2">
                  Type text and press Enter or click play 🔊
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
