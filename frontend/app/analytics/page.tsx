"use client";

import { useState, useEffect } from "react";

interface Analytics {
  total_interactions: number;
  by_engine: { engine: string; count: number; avg_latency: number }[];
  by_language: { detected_language: string; count: number }[];
  recent_errors: any[];
}

interface TraceEntry {
  id: string;
  session_id: string;
  engine: string;
  transcript: string;
  detected_language: string;
  reply_text: string;
  stt_latency_ms: number;
  llm_latency_ms: number;
  tts_latency_ms: number;
  total_latency_ms: number;
  status: string;
  error_message: string;
  created_at: string;
}

const LANG_COLORS: Record<string, string> = {
  en: "from-blue-500 to-blue-600",
  ur: "from-green-500 to-emerald-600",
  ar: "from-amber-500 to-orange-600",
  hi: "from-rose-500 to-pink-600",
  fr: "from-indigo-500 to-violet-600",
  es: "from-yellow-500 to-amber-600",
  de: "from-gray-400 to-gray-500",
  default: "from-gray-500 to-gray-600",
};

const LANG_BG: Record<string, string> = {
  en: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  ur: "bg-green-500/15 text-green-300 border-green-500/30",
  ar: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  hi: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  fr: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  es: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  de: "bg-gray-500/15 text-gray-300 border-gray-500/30",
};

function LatencyBar({ stt, llm, tts, total }: { stt: number; llm: number; tts: number; total: number }) {
  if (total === 0) return <span className="text-gray-600">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5 h-2 w-24 rounded-full overflow-hidden bg-white/5">
        <div className="bg-blue-500" style={{ width: `${(stt / total) * 100}%` }} />
        <div className="bg-purple-500" style={{ width: `${(llm / total) * 100}%` }} />
        <div className="bg-teal-500" style={{ width: `${(tts / total) * 100}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-16 text-right">{Math.round(total)}ms</span>
    </div>
  );
}

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const [filterLang, setFilterLang] = useState("");
  const [filterEngine, setFilterEngine] = useState("");
  const [copyId, setCopyId] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/analytics").then((r) => r.json()),
      fetch("/api/history?limit=100").then((r) => r.json()),
    ]).then(([a, h]) => {
      setAnalytics(a);
      setTraces(h.interactions || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = traces.filter((t) => {
    if (filterLang && t.detected_language !== filterLang) return false;
    if (filterEngine && t.engine !== filterEngine) return false;
    return true;
  });

  const uniqueLangs = [...new Set(traces.map(t => t.detected_language).filter(Boolean))];
  const avgLatency = traces.length > 0
    ? Math.round(traces.reduce((s, t) => s + (t.total_latency_ms || 0), 0) / traces.length)
    : 0;
  const avgSTT = traces.length > 0
    ? Math.round(traces.reduce((s, t) => s + (t.stt_latency_ms || 0), 0) / traces.length)
    : 0;
  const avgTTS = traces.length > 0
    ? Math.round(traces.reduce((s, t) => s + (t.tts_latency_ms || 0), 0) / traces.length)
    : 0;

  const copyTrace = async (t: TraceEntry) => {
    const text = `[${t.created_at}] ${t.detected_language?.toUpperCase()} | ${t.engine}\nYou: ${t.transcript}\nAI: ${t.reply_text}\nSTT: ${Math.round(t.stt_latency_ms)}ms | LLM: ${Math.round(t.llm_latency_ms)}ms | TTS: ${Math.round(t.tts_latency_ms)}ms | Total: ${Math.round(t.total_latency_ms)}ms`;
    await navigator.clipboard.writeText(text);
    setCopyId(t.id);
    setTimeout(() => setCopyId(""), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A1A] text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-400 text-sm">Loading analytics...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A1A] text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-teal-500 flex items-center justify-center">
            <span className="text-lg">📊</span>
          </div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-teal-400 bg-clip-text text-transparent">
            Analytics & Tracing
          </h1>
        </div>
        <a href="/" className="text-sm text-gray-400 hover:text-white transition px-3 py-1.5 rounded-lg hover:bg-white/5">
          🎙️ Voice Portal
        </a>
      </header>

      <div className="p-6 max-w-6xl mx-auto">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
          <div className="bg-[#151528] border border-white/10 rounded-xl p-4">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Total</p>
            <p className="text-2xl font-bold text-white mt-1">{analytics?.total_interactions || 0}</p>
            <p className="text-[10px] text-gray-600 mt-0.5">interactions</p>
          </div>
          <div className="bg-[#151528] border border-white/10 rounded-xl p-4">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Languages</p>
            <p className="text-2xl font-bold text-teal-400 mt-1">{uniqueLangs.length}</p>
            <p className="text-[10px] text-gray-600 mt-0.5">detected</p>
          </div>
          <div className="bg-[#151528] border border-white/10 rounded-xl p-4">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Avg Total</p>
            <p className="text-2xl font-bold text-purple-400 mt-1">{avgLatency > 0 ? `${avgLatency}` : "—"}</p>
            <p className="text-[10px] text-gray-600 mt-0.5">ms latency</p>
          </div>
          <div className="bg-[#151528] border border-white/10 rounded-xl p-4">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Avg STT</p>
            <p className="text-2xl font-bold text-blue-400 mt-1">{avgSTT > 0 ? `${avgSTT}` : "—"}</p>
            <p className="text-[10px] text-gray-600 mt-0.5">ms transcribe</p>
          </div>
          <div className="bg-[#151528] border border-white/10 rounded-xl p-4">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Avg TTS</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{avgTTS > 0 ? `${avgTTS}` : "—"}</p>
            <p className="text-[10px] text-gray-600 mt-0.5">ms synthesize</p>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          {/* By Language */}
          <div className="bg-[#151528] border border-white/10 rounded-xl p-5">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">🌍 Languages</h2>
            {analytics?.by_language?.length ? (
              <div className="space-y-3">
                {analytics.by_language.map((l) => {
                  const maxCount = Math.max(...analytics.by_language.map(x => x.count));
                  const pct = (l.count / maxCount) * 100;
                  const lang = l.detected_language || "unknown";
                  return (
                    <div key={lang}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${LANG_BG[lang] || LANG_BG.default}`}>
                            {lang.toUpperCase()}
                          </span>
                        </div>
                        <span className="text-xs text-gray-400">{l.count}</span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full bg-gradient-to-r ${LANG_COLORS[lang] || LANG_COLORS.default}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-gray-500 text-sm text-center py-4">No data yet</p>
            )}
          </div>

          {/* By Engine */}
          <div className="bg-[#151528] border border-white/10 rounded-xl p-5">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">⚡ Engines</h2>
            {analytics?.by_engine?.length ? (
              <div className="space-y-4">
                {analytics.by_engine.map((e) => (
                  <div key={e.engine} className="bg-[#0A0A1A] rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-white">{e.engine === "local" ? "🖥️ Local" : "☁️ HF API"}</span>
                      <span className="text-xs text-gray-400">{e.count} runs</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-lg font-bold text-purple-400">{Math.round(e.avg_latency)}ms</p>
                        <p className="text-[10px] text-gray-500">Avg Total</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-blue-400">{e.count}</p>
                        <p className="text-[10px] text-gray-500">Interactions</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-teal-400">
                          {e.count > 0 ? Math.round(e.avg_latency / 3) : 0}ms
                        </p>
                        <p className="text-[10px] text-gray-500">Per Stage</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm text-center py-4">No data yet</p>
            )}
          </div>
        </div>

        {/* Tracing Section */}
        <div className="bg-[#151528] border border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">📝 Interaction Traces</h2>
            <div className="flex gap-2">
              <select value={filterLang} onChange={(e) => setFilterLang(e.target.value)}
                className="bg-[#0A0A1A] border border-white/10 rounded-lg px-3 py-1 text-xs text-gray-300 outline-none">
                <option value="">All Languages</option>
                {uniqueLangs.map(l => (
                  <option key={l} value={l}>{(l || "?").toUpperCase()}</option>
                ))}
              </select>
              <select value={filterEngine} onChange={(e) => setFilterEngine(e.target.value)}
                className="bg-[#0A0A1A] border border-white/10 rounded-lg px-3 py-1 text-xs text-gray-300 outline-none">
                <option value="">All Engines</option>
                <option value="local">Local</option>
                <option value="hf">HF API</option>
              </select>
            </div>
          </div>

          {filtered.length > 0 ? (
            <div className="space-y-2">
              {filtered.map((t) => (
                <div key={t.id}
                  className="bg-[#0A0A1A] border border-white/5 rounded-lg hover:border-white/15 transition-all cursor-pointer"
                  onClick={() => setExpandedTrace(expandedTrace === t.id ? null : t.id)}>

                  {/* Summary */}
                  <div className="p-3 flex items-center gap-3">
                    <span className="text-[10px] text-gray-600 w-28 shrink-0 font-mono">
                      {t.created_at ? new Date(t.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${LANG_BG[t.detected_language] || LANG_BG.default}`}>
                      {(t.detected_language || "?").toUpperCase()}
                    </span>
                    <span className="text-[10px] text-gray-600 shrink-0">{t.engine === "local" ? "🖥️" : "☁️"}</span>
                    <span className="text-white text-xs truncate flex-1 min-w-0">{t.transcript || "(no speech)"}</span>
                    <LatencyBar stt={t.stt_latency_ms} llm={t.llm_latency_ms} tts={t.tts_latency_ms} total={t.total_latency_ms} />
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${t.status === "success" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                      {t.status}
                    </span>
                    <span className="text-gray-600 text-xs">{expandedTrace === t.id ? "▲" : "▼"}</span>
                  </div>

                  {/* Expanded Detail */}
                  {expandedTrace === t.id && (
                    <div className="border-t border-white/5 p-4 space-y-3">
                      <div className="grid md:grid-cols-2 gap-3">
                        {/* Input */}
                        <div className="bg-[#151528] rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-[10px] text-gray-500 uppercase tracking-wider">🗣 Input</p>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded border ${LANG_BG[t.detected_language] || LANG_BG.default}`}>
                              {t.detected_language?.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-white text-sm leading-relaxed select-all">{t.transcript || "(no speech detected)"}</p>
                        </div>
                        {/* Output */}
                        <div className="bg-purple-500/5 border border-purple-500/10 rounded-lg p-3">
                          <p className="text-[10px] text-purple-400 uppercase tracking-wider mb-1.5">🤖 Output</p>
                          <p className="text-white text-sm leading-relaxed select-all">{t.reply_text || "(no reply)"}</p>
                        </div>
                      </div>

                      {/* Pipeline */}
                      <div className="flex items-center gap-1">
                        <div className="flex-1 bg-blue-500/10 border border-blue-500/20 rounded-lg p-2 text-center">
                          <p className="text-[9px] text-blue-400 uppercase">STT</p>
                          <p className="text-sm font-bold text-blue-300">{Math.round(t.stt_latency_ms)}ms</p>
                        </div>
                        <span className="text-gray-600">→</span>
                        <div className="flex-1 bg-purple-500/10 border border-purple-500/20 rounded-lg p-2 text-center">
                          <p className="text-[9px] text-purple-400 uppercase">LLM</p>
                          <p className="text-sm font-bold text-purple-300">{Math.round(t.llm_latency_ms)}ms</p>
                        </div>
                        <span className="text-gray-600">→</span>
                        <div className="flex-1 bg-teal-500/10 border border-teal-500/20 rounded-lg p-2 text-center">
                          <p className="text-[9px] text-teal-400 uppercase">TTS</p>
                          <p className="text-sm font-bold text-teal-300">{Math.round(t.tts_latency_ms)}ms</p>
                        </div>
                        <span className="text-gray-600">=</span>
                        <div className="flex-1 bg-white/5 border border-white/10 rounded-lg p-2 text-center">
                          <p className="text-[9px] text-gray-400 uppercase">Total</p>
                          <p className="text-sm font-bold text-white">{Math.round(t.total_latency_ms)}ms</p>
                        </div>
                      </div>

                      {/* Meta + Copy */}
                      <div className="flex items-center justify-between">
                        <div className="flex gap-3 text-[10px] text-gray-600">
                          <span>ID: <span className="font-mono">{t.id}</span></span>
                          <span>Session: <span className="font-mono">{t.session_id?.slice(0, 8)}</span></span>
                          {t.error_message && <span className="text-red-400">Error: {t.error_message}</span>}
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); copyTrace(t); }}
                          className="text-[10px] text-gray-500 hover:text-white px-2 py-1 rounded bg-white/5 hover:bg-white/10 transition">
                          {copyId === t.id ? "✓ Copied" : "📋 Copy trace"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">🎙️</div>
              <p className="text-gray-400 text-sm">No interactions yet</p>
              <p className="text-gray-600 text-xs mt-1">Start speaking in the Voice Portal to see traces here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
