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
    <div className="h-screen bg-[#212121] text-white flex flex-col">
      {/* Header */}
      <header className="bg-[#171717] px-5 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#10a37f] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              <line x1="12" y1="19" x2="12" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              <line x1="8" y1="23" x2="16" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-sm font-medium text-white/90">Voice Portal</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Tab Switcher */}
          <div className="flex bg-[#2f2f2f] rounded-lg p-0.5">
            <button onClick={() => setActiveTab("stt")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTab === "stt"
                  ? "bg-[#424242] text-white"
                  : "text-white/50 hover:text-white/70"
              }`}>
              🎤 Speech
            </button>
            <button onClick={() => setActiveTab("tts")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTab === "tts"
                  ? "bg-[#424242] text-white"
                  : "text-white/50 hover:text-white/70"
              }`}>
              🔊 Voice
            </button>
          </div>

          <a href="/analytics" className="text-xs text-white/40 hover:text-white/70 transition px-2 py-1 rounded hover:bg-white/5">
            📊
          </a>
          <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-[#10a37f]" : "bg-red-500 animate-pulse"}`} />
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
          {messages.length === 0 && !streamingText && (
            <div className="text-center py-24">
              <div className="w-14 h-14 rounded-full bg-[#10a37f] flex items-center justify-center mx-auto mb-4">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <line x1="12" y1="19" x2="12" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <line x1="8" y1="23" x2="16" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <h2 className="text-xl font-medium text-white/90 mb-2">How can I help you?</h2>
              <p className="text-sm text-white/40">Speak or type in any language — I&apos;ll transcribe and speak it back</p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] ${msg.role === "user" ? "" : ""}`}>
                {msg.role === "assistant" && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-5 h-5 rounded-sm bg-[#10a37f] flex items-center justify-center">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/></svg>
                    </div>
                    <span className="text-xs text-white/40">Voice Portal</span>
                  </div>
                )}
                <div className={`text-[15px] leading-relaxed ${
                  msg.role === "user" ? "text-white/90" : "text-white/80"
                }`}>
                  {msg.text}
                  {msg.language && msg.role === "user" && (
                    <span className="ml-2 text-[10px] text-white/25 align-middle">{msg.language.toUpperCase()}</span>
                  )}
                </div>
              </div>
            </div>
          ))}

          {streamingText && (
            <div className="flex justify-end">
              <div className="max-w-[85%]">
                <div className="text-[15px] leading-relaxed text-white/90">
                  {streamingText}
                  <span className="inline-block w-[2px] h-4 bg-white/50 ml-0.5 animate-pulse align-middle" />
                </div>
              </div>
            </div>
          )}

          {isProcessing && (
            <div className="flex justify-start">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-5 h-5 rounded-sm bg-[#10a37f] flex items-center justify-center">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/></svg>
                  </div>
                  <span className="text-xs text-white/40">Voice Portal</span>
                </div>
                <div className="flex gap-1.5">
                  <div className="w-2 h-2 bg-white/30 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-2 h-2 bg-white/30 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-2 h-2 bg-white/30 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="text-center">
              <span className="text-xs text-red-400/80">{error}</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-[#212121] px-4 pb-5 pt-2 shrink-0">
        <div className="max-w-2xl mx-auto">
          <div className="bg-[#2f2f2f] rounded-2xl px-4 py-3">
            {activeTab === "stt" ? (
              /* STT Input */
              <div className="flex items-center gap-3">
                <button onClick={toggleMic} disabled={isProcessing}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 ${
                    stage === "listening"
                      ? "bg-red-500"
                      : "bg-[#424242] hover:bg-[#525252]"
                  } disabled:opacity-50`}>
                  <span className="text-lg">{stage === "listening" ? "⏹" : isProcessing ? "⏳" : "🎤"}</span>
                </button>
                <div className="flex-1">
                  <p className="text-sm text-white/60">
                    {stage === "listening" ? "Listening..." : isProcessing ? "Processing..." : "Tap mic to start speaking"}
                  </p>
                </div>
                <select value={selectedLanguage} onChange={(e) => setSelectedLanguage(e.target.value)}
                  className="bg-[#424242] border-none rounded-lg px-2 py-1.5 text-xs text-white/60 outline-none cursor-pointer">
                  <option value="auto">Auto</option>
                  {voices.map((v) => (
                    <option key={v.code} value={v.code}>{v.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              /* TTS Input */
              <div className="flex items-end gap-2">
                <textarea ref={textareaRef} value={ttsText} onChange={(e) => setTtsText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type text to hear it spoken..."
                  rows={1}
                  className="flex-1 bg-transparent text-sm text-white/90 placeholder-white/30 outline-none resize-none py-1 max-h-[120px]"
                  disabled={isProcessing} />
                <div className="flex items-center gap-2 shrink-0">
                  <select value={ttsLanguage} onChange={(e) => setTtsLanguage(e.target.value)}
                    className="bg-[#424242] border-none rounded-lg px-2 py-1.5 text-xs text-white/60 outline-none cursor-pointer">
                    {voices.map((v) => (
                      <option key={v.code} value={v.code}>{v.name}</option>
                    ))}
                  </select>
                  <button onClick={sendTTS} disabled={!ttsText.trim() || isProcessing}
                    className="w-8 h-8 rounded-lg bg-[#10a37f] flex items-center justify-center hover:bg-[#0e8f6e] transition disabled:opacity-30">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                      <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
          <p className="text-center text-[11px] text-white/20 mt-2">
            {activeTab === "stt"
              ? "Speak in any language — real-time transcription"
              : "Type text — hear it spoken in any language"
            }
          </p>
        </div>
      </div>
    </div>
  );
}
