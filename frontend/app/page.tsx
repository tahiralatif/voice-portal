"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type Stage = "idle" | "listening" | "transcribing" | "speaking";

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
  isStreaming?: boolean;
}

export default function Home() {
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

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + "px";
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
            setStreamingText(data.text || "");
          }
          break;
        case "transcript":
          // Replace streaming message with final transcript
          setMessages(prev => {
            const withoutStreaming = prev.filter(m => !m.isStreaming);
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
          // Add assistant message with transcript (what was spoken back)
          setMessages(prev => {
            const lastUser = [...prev].reverse().find(m => m.role === "user");
            const replyText = lastUser?.text || "Audio played";
            return [...prev, {
              id: crypto.randomUUID(),
              role: "assistant",
              text: replyText,
              timestamp: Date.now(),
            }];
          });
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

  const sendTextMessage = () => {
    if (!ttsText.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setStage("speaking");
    setError("");
    wsRef.current.send(JSON.stringify({ type: "text", text: ttsText, language: ttsLanguage }));

    // Add user message
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
      sendTextMessage();
    }
  };

  const isProcessing = stage === "transcribing" || stage === "speaking";

  return (
    <div className="h-screen bg-[#f8f9fa] flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
            <span className="text-sm">🎙️</span>
          </div>
          <h1 className="text-base font-semibold text-gray-800">Voice Portal</h1>
        </div>
        <div className="flex items-center gap-3">
          <select value={selectedLanguage} onChange={(e) => setSelectedLanguage(e.target.value)}
            className="bg-gray-100 border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600 outline-none cursor-pointer hover:bg-gray-200 transition">
            <option value="auto">🔍 Auto-detect</option>
            {voices.map((v) => (
              <option key={v.code} value={v.code}>{v.name}</option>
            ))}
          </select>
          <a href="/analytics" className="text-xs text-gray-500 hover:text-gray-800 transition px-2 py-1.5 rounded-lg hover:bg-gray-100">
            📊
          </a>
          <div className={`w-2 h-2 rounded-full ${wsConnected ? "bg-green-500" : "bg-red-500 animate-pulse"}`} />
        </div>
      </header>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.length === 0 && !streamingText && (
            <div className="text-center py-20">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">🎙️</span>
              </div>
              <h2 className="text-lg font-semibold text-gray-800 mb-2">Voice Portal</h2>
              <p className="text-sm text-gray-500 mb-1">Speak or type in any language</p>
              <p className="text-xs text-gray-400">Tap the mic to start • Urdu ke liye language select karein</p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`flex gap-2 max-w-[80%] ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                {/* Avatar */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-medium ${
                  msg.role === "user"
                    ? "bg-blue-500 text-white"
                    : "bg-gray-200 text-gray-600"
                }`}>
                  {msg.role === "user" ? "You" : "AI"}
                </div>
                {/* Bubble */}
                <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-gray-800 text-white rounded-br-md"
                    : "bg-white border border-gray-200 text-gray-800 rounded-bl-md shadow-sm"
                }`}>
                  {msg.text}
                  {msg.language && msg.role === "user" && (
                    <span className="ml-2 text-[10px] opacity-50">{msg.language.toUpperCase()}</span>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Streaming message */}
          {streamingText && (
            <div className="flex justify-end">
              <div className="flex gap-2 max-w-[80%] flex-row-reverse">
                <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center shrink-0 text-xs font-medium">
                  You
                </div>
                <div className="bg-gray-800 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed">
                  <span className="opacity-70 italic">{streamingText}</span>
                  <span className="inline-block w-1 h-4 bg-white/50 ml-1 animate-pulse" />
                </div>
              </div>
            </div>
          )}

          {/* Typing indicator */}
          {isProcessing && (
            <div className="flex justify-start">
              <div className="flex gap-2">
                <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center shrink-0 text-xs font-medium">
                  AI
                </div>
                <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex justify-center">
              <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-2 text-xs">
                {error}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-white border-t border-gray-200 px-4 py-3 shrink-0">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-end gap-2 bg-gray-100 rounded-2xl px-3 py-2">
            {/* Mic Button */}
            <button onClick={toggleMic} disabled={isProcessing}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 shrink-0 mb-0.5 ${
                stage === "listening"
                  ? "bg-red-500 text-white shadow-lg animate-pulse"
                  : isProcessing
                    ? "bg-yellow-400 text-white"
                    : "bg-gray-200 text-gray-600 hover:bg-gray-300"
              } disabled:opacity-50`}>
              <span className="text-lg">{stage === "listening" ? "⏹" : isProcessing ? "⏳" : "🎤"}</span>
            </button>

            {/* Text Input */}
            <textarea ref={textareaRef} value={ttsText} onChange={(e) => setTtsText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={stage === "listening" ? "Listening..." : "Type a message or tap mic to speak..."}
              rows={1}
              className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none resize-none py-2 max-h-[150px]"
              disabled={isProcessing} />

            {/* Send Button */}
            <button onClick={sendTextMessage} disabled={!ttsText.trim() || isProcessing}
              className="w-10 h-10 rounded-full bg-gray-800 text-white flex items-center justify-center shrink-0 mb-0.5 hover:bg-gray-700 transition disabled:opacity-30 disabled:hover:bg-gray-800">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <p className="text-[10px] text-gray-400 text-center mt-2">
            {stage === "listening" ? "🔴 Listening... tap mic to stop" : "Tap 🎤 to speak • Type to send text"}
          </p>
        </div>
      </div>
    </div>
  );
}
