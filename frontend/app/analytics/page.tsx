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
};

const LANG_BG: Record<string, string> = {
  en: "bg-blue-100 text-blue-700 border-blue-200",
  ur: "bg-green-100 text-green-700 border-green-200",
  ar: "bg-amber-100 text-amber-700 border-amber-200",
  hi: "bg-rose-100 text-rose-700 border-rose-200",
  fr: "bg-indigo-100 text-indigo-700 border-indigo-200",
  es: "bg-yellow-100 text-yellow-700 border-yellow-200",
  de: "bg-gray-100 text-gray-700 border-gray-200",
};

function LatencyBar({ stt, llm, tts, total }: { stt: number; llm: number; tts: number; total: number }) {
  if (total === 0) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5 h-2 w-24 rounded-full overflow-hidden bg-slate-100">
        <div className="bg-blue-500" style={{ width: `${(stt / total) * 100}%` }} />
        <div className="bg-violet-500" style={{ width: `${(llm / total) * 100}%` }} />
        <div className="bg-emerald-500" style={{ width: `${(tts / total) * 100}%` }} />
      </div>
      <span className="text-xs text-slate-400 w-16 text-right">{Math.round(total)}ms</span>
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
  const avgLatency = traces.length > 0 ? Math.round(traces.reduce((s, t) => s + (t.total_latency_ms || 0), 0) / traces.length) : 0;
  const avgSTT = traces.length > 0 ? Math.round(traces.reduce((s, t) => s + (t.stt_latency_ms || 0), 0) / traces.length) : 0;
  const avgTTS = traces.length > 0 ? Math.round(traces.reduce((s, t) => s + (t.tts_latency_ms || 0), 0) / traces.length) : 0;

  const copyTrace = async (t: TraceEntry) => {
    const text = `[${t.created_at}] ${t.detected_language?.toUpperCase()} | ${t.engine}\nYou: ${t.transcript}\nAI: ${t.reply_text}\nSTT: ${Math.round(t.stt_latency_ms)}ms | TTS: ${Math.round(t.tts_latency_ms)}ms | Total: ${Math.round(t.total_latency_ms)}ms`;
    await navigator.clipboard.writeText(text);
    setCopyId(t.id);
    setTimeout(() => setCopyId(""), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-violet-50/30 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-400 text-sm">Loading analytics...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-violet-50/30">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200/60 px-6 py-4 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
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
              <h1 className="text-lg font-bold text-slate-900">Analytics</h1>
              <p className="text-[10px] text-slate-400 tracking-wider uppercase">Interaction Traces & Insights</p>
            </div>
          </div>
          <a href="/" className="text-sm text-slate-500 hover:text-violet-600 transition px-3 py-1.5 rounded-lg hover:bg-violet-50">🎤 Voice Portal</a>
        </div>
      </header>

      <div className="p-6 max-w-6xl mx-auto">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
          {[
            { label: "Total", value: analytics?.total_interactions || 0, sub: "interactions", color: "text-slate-900" },
            { label: "Languages", value: uniqueLangs.length, sub: "detected", color: "text-violet-600" },
            { label: "Avg Total", value: avgLatency > 0 ? `${avgLatency}ms` : "—", sub: "latency", color: "text-indigo-600" },
            { label: "Avg STT", value: avgSTT > 0 ? `${avgSTT}ms` : "—", sub: "transcribe", color: "text-blue-600" },
            { label: "Avg TTS", value: avgTTS > 0 ? `${avgTTS}ms` : "—", sub: "synthesize", color: "text-emerald-600" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-4">
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Charts Row */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          {/* By Language */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">🌍 Languages</h2>
            {analytics?.by_language?.length ? (
              <div className="space-y-3">
                {analytics.by_language.map((l) => {
                  const maxCount = Math.max(...analytics.by_language.map(x => x.count));
                  const pct = (l.count / maxCount) * 100;
                  const lang = l.detected_language || "unknown";
                  return (
                    <div key={lang}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${LANG_BG[lang] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                          {lang.toUpperCase()}
                        </span>
                        <span className="text-xs text-slate-500">{l.count}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full bg-gradient-to-r ${LANG_COLORS[lang] || "from-slate-400 to-slate-500"}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-slate-400 text-sm text-center py-4">No data yet</p>
            )}
          </div>

          {/* By Engine */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">⚡ Engines</h2>
            {analytics?.by_engine?.length ? (
              <div className="space-y-4">
                {analytics.by_engine.map((e) => (
                  <div key={e.engine} className="bg-slate-50 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-800">{e.engine === "local" ? "🖥️ Local Whisper" : "☁️ HF API"}</span>
                      <span className="text-xs text-slate-400">{e.count} runs</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div>
                        <p className="text-lg font-bold text-violet-600">{Math.round(e.avg_latency)}ms</p>
                        <p className="text-[10px] text-slate-400">Avg Latency</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-blue-600">{e.count}</p>
                        <p className="text-[10px] text-slate-400">Interactions</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-sm text-center py-4">No data yet</p>
            )}
          </div>
        </div>

        {/* Tracing Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">📝 Interaction Traces</h2>
            <div className="flex gap-2">
              <select value={filterLang} onChange={(e) => setFilterLang(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 text-xs text-slate-600 outline-none cursor-pointer">
                <option value="">All Languages</option>
                {uniqueLangs.map(l => <option key={l} value={l}>{(l || "?").toUpperCase()}</option>)}
              </select>
              <select value={filterEngine} onChange={(e) => setFilterEngine(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 text-xs text-slate-600 outline-none cursor-pointer">
                <option value="">All Engines</option>
                <option value="local">Local</option>
              </select>
            </div>
          </div>

          {filtered.length > 0 ? (
            <div className="space-y-2">
              {filtered.map((t) => (
                <div key={t.id}
                  className="bg-slate-50 border border-slate-200/60 rounded-xl hover:border-violet-300 hover:shadow-sm transition-all cursor-pointer"
                  onClick={() => setExpandedTrace(expandedTrace === t.id ? null : t.id)}>

                  <div className="p-3 flex items-center gap-3">
                    <span className="text-[10px] text-slate-400 w-28 shrink-0 font-mono">
                      {t.created_at ? new Date(t.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium shrink-0 ${LANG_BG[t.detected_language] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                      {(t.detected_language || "?").toUpperCase()}
                    </span>
                    <span className="text-white text-xs truncate flex-1 min-w-0">{t.transcript || "(no speech)"}</span>
                    <LatencyBar stt={t.stt_latency_ms} llm={0} tts={t.tts_latency_ms} total={t.total_latency_ms} />
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${t.status === "success" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                      {t.status}
                    </span>
                    <span className="text-slate-400 text-xs">{expandedTrace === t.id ? "▲" : "▼"}</span>
                  </div>

                  {expandedTrace === t.id && (
                    <div className="border-t border-slate-200/60 p-4 space-y-3">
                      <div className="grid md:grid-cols-2 gap-3">
                        <div className="bg-white rounded-xl p-3 border border-slate-200/60">
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1.5">🗣 Input</p>
                          <p className="text-slate-800 text-sm leading-relaxed select-all">{t.transcript || "(no speech detected)"}</p>
                        </div>
                        <div className="bg-violet-50 border border-violet-200/60 rounded-xl p-3">
                          <p className="text-[10px] text-violet-500 uppercase tracking-wider mb-1.5">🔊 Echo Back</p>
                          <p className="text-slate-800 text-sm leading-relaxed select-all">{t.reply_text || "(no reply)"}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <div className="flex-1 bg-blue-50 border border-blue-200/60 rounded-xl p-2 text-center">
                          <p className="text-[9px] text-blue-500 uppercase">STT</p>
                          <p className="text-sm font-bold text-blue-600">{Math.round(t.stt_latency_ms)}ms</p>
                        </div>
                        <span className="text-slate-300">→</span>
                        <div className="flex-1 bg-emerald-50 border border-emerald-200/60 rounded-xl p-2 text-center">
                          <p className="text-[9px] text-emerald-500 uppercase">TTS</p>
                          <p className="text-sm font-bold text-emerald-600">{Math.round(t.tts_latency_ms)}ms</p>
                        </div>
                        <span className="text-slate-300">=</span>
                        <div className="flex-1 bg-slate-50 border border-slate-200/60 rounded-xl p-2 text-center">
                          <p className="text-[9px] text-slate-400 uppercase">Total</p>
                          <p className="text-sm font-bold text-slate-800">{Math.round(t.total_latency_ms)}ms</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex gap-3 text-[10px] text-slate-400">
                          <span>ID: <span className="font-mono">{t.id}</span></span>
                          <span>Session: <span className="font-mono">{t.session_id?.slice(0, 8)}</span></span>
                          {t.error_message && <span className="text-red-500">Error: {t.error_message}</span>}
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); copyTrace(t); }}
                          className="text-[10px] text-slate-500 hover:text-violet-600 px-2 py-1 rounded-lg bg-slate-100 hover:bg-violet-50 transition">
                          {copyId === t.id ? "✓ Copied" : "📋 Copy"}
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
              <p className="text-slate-500 text-sm">No interactions yet</p>
              <p className="text-slate-400 text-xs mt-1">Start speaking to see traces here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
