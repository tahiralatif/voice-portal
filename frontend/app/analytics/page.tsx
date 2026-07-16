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

const LANG_FLAGS: Record<string, string> = {
  en: "🇬🇧", ur: "🇵🇰", hi: "🇮🇳", ar: "🇸🇦", fr: "🇫🇷", es: "🇪🇸",
  de: "🇩🇪", pt: "🇧🇷", tl: "🇵🇭", th: "🇹🇭", ne: "🇳🇵", ml: "🇮🇳",
  bn: "🇧🇩", ta: "🇮🇳", te: "🇮🇳", ko: "🇰🇷", ja: "🇯🇵", zh: "🇨🇳",
  ru: "🇷🇺", it: "🇮🇹", tr: "🇹🇷", nl: "🇳🇱", pl: "🇵🇱", vi: "🇻🇳",
  id: "🇮🇩", ms: "🇲🇾", sw: "🇰🇪", pa: "🇮🇳",
};

const LANG_COLORS: Record<string, { bar: string; dot: string; bg: string; text: string; border: string }> = {
  en: { bar: "from-blue-500 to-indigo-500", dot: "bg-blue-500", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  ur: { bar: "from-emerald-500 to-teal-500", dot: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  hi: { bar: "from-orange-500 to-amber-500", dot: "bg-orange-500", bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
  ar: { bar: "from-violet-500 to-purple-500", dot: "bg-violet-500", bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
  fr: { bar: "from-sky-500 to-cyan-500", dot: "bg-sky-500", bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200" },
  es: { bar: "from-rose-500 to-pink-500", dot: "bg-rose-500", bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
};

const DEFAULT_LANG_COLOR = { bar: "from-slate-400 to-slate-500", dot: "bg-slate-400", bg: "bg-slate-50", text: "text-slate-600", border: "border-slate-200" };

function getLangColor(lang: string) {
  return LANG_COLORS[lang] || DEFAULT_LANG_COLOR;
}

function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const duration = 800;
    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [value]);
  return <>{display.toLocaleString()}{suffix}</>;
}

function StatCard({ label, value, suffix, icon, gradient, delay }: {
  label: string; value: number; suffix?: string; icon: string; gradient: string; delay: number;
}) {
  return (
    <div className="relative group" style={{ animationDelay: `${delay}ms` }}>
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl`} />
      <div className="relative bg-white rounded-2xl border border-slate-200/80 p-5 hover:shadow-lg hover:shadow-slate-200/50 hover:border-slate-300/80 transition-all duration-300">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">{label}</span>
          <span className="text-lg">{icon}</span>
        </div>
        <p className="text-3xl font-bold text-slate-900 tracking-tight">
          <AnimatedNumber value={value} suffix={suffix} />
        </p>
      </div>
    </div>
  );
}

function LanguageChart({ languages, total }: { languages: Analytics["by_language"]; total: number }) {
  if (!languages?.length) return <EmptyState icon="🌍" text="No language data yet" />;
  const sorted = [...languages].sort((a, b) => b.count - a.count);
  const maxCount = sorted[0]?.count || 1;

  return (
    <div className="space-y-3">
      {sorted.slice(0, 8).map((l) => {
        const lang = l.detected_language || "unknown";
        const color = getLangColor(lang);
        const pct = (l.count / maxCount) * 100;
        const share = total > 0 ? Math.round((l.count / total) * 100) : 0;
        return (
          <div key={lang} className="group">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${color.dot}`} />
                <span className="text-xs font-semibold text-slate-700">{lang.toUpperCase()}</span>
                <span className="text-xs">{LANG_FLAGS[lang] || "🌐"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">{share}%</span>
                <span className="text-xs font-semibold text-slate-600">{l.count}</span>
              </div>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${color.bar} transition-all duration-1000 ease-out`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
      {sorted.length > 8 && (
        <p className="text-[10px] text-slate-400 text-center mt-2">+{sorted.length - 8} more languages</p>
      )}
    </div>
  );
}

function LatencyBreakdown({ traces }: { traces: TraceEntry[] }) {
  if (!traces.length) return <EmptyState icon="⏱" text="No latency data yet" />;
  const avgSTT = Math.round(traces.reduce((s, t) => s + (t.stt_latency_ms || 0), 0) / traces.length);
  const avgTTS = Math.round(traces.reduce((s, t) => s + (t.tts_latency_ms || 0), 0) / traces.length);
  const maxSTT = Math.max(...traces.map(t => t.stt_latency_ms || 0));
  const maxTTS = Math.max(...traces.map(t => t.tts_latency_ms || 0));

  const stages = [
    { label: "Speech to Text", avg: avgSTT, max: maxSTT, color: "from-blue-500 to-indigo-600", bgColor: "bg-blue-50", textColor: "text-blue-600", icon: "🗣" },
    { label: "Text to Speech", avg: avgTTS, max: maxTTS, color: "from-emerald-500 to-teal-600", bgColor: "bg-emerald-50", textColor: "text-emerald-600", icon: "🔊" },
  ];

  return (
    <div className="space-y-4">
      {stages.map((s) => (
        <div key={s.label} className={`${s.bgColor} rounded-xl p-4`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span>{s.icon}</span>
              <span className="text-xs font-semibold text-slate-700">{s.label}</span>
            </div>
            <span className={`text-lg font-bold ${s.textColor}`}>{s.avg.toLocaleString()}ms</span>
          </div>
          <div className="h-1.5 bg-white/60 rounded-full overflow-hidden mb-1.5">
            <div className={`h-full rounded-full bg-gradient-to-r ${s.color}`} style={{ width: `${Math.min((s.avg / (s.max || 1)) * 100, 100)}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>avg: {s.avg.toLocaleString()}ms</span>
            <span>max: {s.max.toLocaleString()}ms</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityTimeline({ traces }: { traces: TraceEntry[] }) {
  if (!traces.length) return <EmptyState icon="📈" text="No activity yet" />;
  // Group by hour for last 24h
  const now = new Date();
  const hours: { label: string; count: number; success: number; fail: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const h = new Date(now.getTime() - i * 3600000);
    const hourStr = h.toISOString().slice(0, 13);
    const label = h.toLocaleTimeString("en-US", { hour: "2-digit", hour12: false });
    const hourTraces = traces.filter(t => t.created_at?.startsWith(hourStr));
    hours.push({
      label,
      count: hourTraces.length,
      success: hourTraces.filter(t => t.status === "success").length,
      fail: hourTraces.filter(t => t.status !== "success").length,
    });
  }
  const maxCount = Math.max(...hours.map(h => h.count), 1);

  return (
    <div>
      <div className="flex items-end gap-[2px] h-20">
        {hours.map((h, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group" title={`${h.label}: ${h.count} interactions`}>
            <div className="w-full flex flex-col gap-[1px] justify-end" style={{ height: `${Math.max((h.count / maxCount) * 100, h.count > 0 ? 8 : 0)}%` }}>
              {h.success > 0 && <div className="bg-emerald-400 rounded-t-sm min-h-[2px]" style={{ flex: h.success }} />}
              {h.fail > 0 && <div className="bg-red-400 rounded-t-sm min-h-[2px]" style={{ flex: h.fail }} />}
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-2 text-[9px] text-slate-400 font-mono">
        <span>{hours[0]?.label}</span>
        <span className="text-slate-300">|</span>
        <span className="text-slate-300">|</span>
        <span className="text-slate-300">|</span>
        <span>{hours[Math.floor(hours.length / 2)]?.label}</span>
        <span className="text-slate-300">|</span>
        <span className="text-slate-300">|</span>
        <span className="text-slate-300">|</span>
        <span>{hours[hours.length - 1]?.label}</span>
      </div>
      <div className="flex items-center justify-center gap-4 mt-3">
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-400" /><span className="text-[10px] text-slate-500">Success</span></div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-400" /><span className="text-[10px] text-slate-500">Failed</span></div>
      </div>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8">
      <span className="text-3xl mb-2">{icon}</span>
      <p className="text-slate-400 text-sm">{text}</p>
    </div>
  );
}

function TraceRow({ trace, expanded, onToggle, onCopy, copyId }: {
  trace: TraceEntry; expanded: boolean; onToggle: () => void; onCopy: () => void; copyId: string;
}) {
  const langColor = getLangColor(trace.detected_language);
  const timeStr = trace.created_at
    ? new Date(trace.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
  const pipelinePct = {
    stt: trace.total_latency_ms > 0 ? (trace.stt_latency_ms / trace.total_latency_ms) * 100 : 0,
    tts: trace.total_latency_ms > 0 ? (trace.tts_latency_ms / trace.total_latency_ms) * 100 : 0,
  };

  return (
    <div className={`rounded-xl border transition-all duration-200 ${expanded ? "border-violet-200 shadow-md shadow-violet-100/50" : "border-slate-200/60 hover:border-slate-300 hover:shadow-sm"}`}>
      {/* Summary row */}
      <div onClick={onToggle} className="flex items-center gap-3 px-4 py-3 cursor-pointer">
        {/* Time */}
        <span className="text-[11px] text-slate-400 w-24 shrink-0 font-mono">{timeStr}</span>

        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full shrink-0 ${trace.status === "success" ? "bg-emerald-400" : "bg-red-400"}`} />

        {/* Language badge */}
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold shrink-0 ${langColor.bg} ${langColor.text} ${langColor.border}`}>
          {LANG_FLAGS[trace.detected_language] || "🌐"} {(trace.detected_language || "?").toUpperCase()}
        </span>

        {/* Transcript */}
        <span className="text-sm text-slate-700 truncate flex-1 min-w-0">{trace.transcript || "(no speech)"}</span>

        {/* Latency inline bar */}
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          <div className="flex gap-[1px] h-1.5 w-16 rounded-full overflow-hidden bg-slate-100">
            <div className="bg-blue-500 rounded-full" style={{ width: `${pipelinePct.stt}%` }} />
            <div className="bg-emerald-500 rounded-full" style={{ width: `${pipelinePct.tts}%` }} />
          </div>
          <span className="text-[10px] text-slate-400 font-mono w-12 text-right">{Math.round(trace.total_latency_ms)}ms</span>
        </div>

        {/* Chevron */}
        <svg className={`w-4 h-4 text-slate-300 shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-slate-100 px-4 py-4 space-y-4">
          {/* Input / Output cards */}
          <div className="grid md:grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs">🗣</span>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Transcript</span>
              </div>
              <p className="text-sm text-slate-800 leading-relaxed select-all">{trace.transcript || "(no speech detected)"}</p>
            </div>
            <div className="bg-gradient-to-br from-violet-50 to-indigo-50 rounded-xl p-4 border border-violet-100">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs">🔊</span>
                <span className="text-[10px] text-violet-400 uppercase tracking-wider font-medium">Echo Back</span>
              </div>
              <p className="text-sm text-slate-800 leading-relaxed select-all">{trace.reply_text || "(no reply)"}</p>
            </div>
          </div>

          {/* Pipeline visualization */}
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-blue-50 border border-blue-100 rounded-xl p-3 text-center relative overflow-hidden">
              <div className="absolute bottom-0 left-0 right-0 bg-blue-100/50" style={{ height: `${Math.min(pipelinePct.stt, 100)}%` }} />
              <div className="relative">
                <p className="text-[10px] text-blue-400 uppercase tracking-wider font-medium">STT</p>
                <p className="text-lg font-bold text-blue-600">{Math.round(trace.stt_latency_ms).toLocaleString()}ms</p>
              </div>
            </div>
            <svg className="w-5 h-5 text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <div className="flex-1 bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center relative overflow-hidden">
              <div className="absolute bottom-0 left-0 right-0 bg-emerald-100/50" style={{ height: `${Math.min(pipelinePct.tts, 100)}%` }} />
              <div className="relative">
                <p className="text-[10px] text-emerald-400 uppercase tracking-wider font-medium">TTS</p>
                <p className="text-lg font-bold text-emerald-600">{Math.round(trace.tts_latency_ms).toLocaleString()}ms</p>
              </div>
            </div>
            <svg className="w-5 h-5 text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Total</p>
              <p className="text-lg font-bold text-slate-800">{Math.round(trace.total_latency_ms).toLocaleString()}ms</p>
            </div>
          </div>

          {/* Meta footer */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400">
              <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{trace.id}</span>
              <span>Session <span className="font-mono">{trace.session_id?.slice(0, 8)}</span></span>
              {trace.error_message && <span className="text-red-500 font-medium">⚠ {trace.error_message}</span>}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onCopy(); }}
              className="text-[10px] text-slate-400 hover:text-violet-600 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-violet-50 transition font-medium"
            >
              {copyId === trace.id ? "✓ Copied" : "📋 Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const [filterLang, setFilterLang] = useState("");
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
    return true;
  });

  const uniqueLangs = [...new Set(traces.map(t => t.detected_language).filter(Boolean))];
  const avgLatency = traces.length > 0 ? Math.round(traces.reduce((s, t) => s + (t.total_latency_ms || 0), 0) / traces.length) : 0;
  const successRate = traces.length > 0 ? Math.round((traces.filter(t => t.status === "success").length / traces.length) * 100) : 0;
  const uniqueSessions = new Set(traces.map(t => t.session_id)).size;

  const copyTrace = async (t: TraceEntry) => {
    const text = `[${t.created_at}] ${t.detected_language?.toUpperCase()}\n🗣 ${t.transcript}\n🔊 ${t.reply_text}\nSTT: ${Math.round(t.stt_latency_ms)}ms | TTS: ${Math.round(t.tts_latency_ms)}ms | Total: ${Math.round(t.total_latency_ms)}ms`;
    await navigator.clipboard.writeText(text);
    setCopyId(t.id);
    setTimeout(() => setCopyId(""), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-violet-50/30 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 border-3 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
          </div>
          <p className="text-slate-400 text-sm font-medium">Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-violet-50/30">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200/60 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><rect x="3" y="12" width="4" height="9" rx="1" /><rect x="8" y="8" width="4" height="13" rx="1" /><rect x="13" y="4" width="4" height="17" rx="1" /><rect x="18" y="9" width="4" height="12" rx="1" /></svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Voice Analytics</h1>
              <p className="text-[11px] text-slate-400">{analytics?.total_interactions || 0} interactions tracked</p>
            </div>
          </div>
          <a href="/" className="flex items-center gap-2 text-sm text-slate-500 hover:text-violet-600 transition px-4 py-2 rounded-xl hover:bg-violet-50 font-medium">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            Voice Portal
          </a>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Hero stats */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-10">
          <StatCard label="Total" value={analytics?.total_interactions || 0} icon="🎯" gradient="from-violet-500/10 to-violet-500/5" delay={0} />
          <StatCard label="Languages" value={uniqueLangs.length} icon="🌍" gradient="from-blue-500/10 to-blue-500/5" delay={50} />
          <StatCard label="Avg Latency" value={avgLatency} suffix="ms" icon="⚡" gradient="from-amber-500/10 to-amber-500/5" delay={100} />
          <StatCard label="Success" value={successRate} suffix="%" icon="✅" gradient="from-emerald-500/10 to-emerald-500/5" delay={150} />
          <StatCard label="Sessions" value={uniqueSessions} icon="👥" gradient="from-rose-500/10 to-rose-500/5" delay={200} />
        </div>

        {/* Charts grid */}
        <div className="grid lg:grid-cols-3 gap-5 mb-8">
          {/* Language distribution */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-5">Language Distribution</h2>
            <LanguageChart languages={analytics?.by_language || []} total={analytics?.total_interactions || 0} />
          </div>

          {/* Latency breakdown */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-5">Latency Breakdown</h2>
            <LatencyBreakdown traces={traces} />
          </div>

          {/* Activity timeline */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-5">Activity (24h)</h2>
            <ActivityTimeline traces={traces} />
          </div>
        </div>

        {/* Traces list */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recent Interactions</h2>
            <div className="flex items-center gap-2">
              <select
                value={filterLang}
                onChange={(e) => setFilterLang(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-600 outline-none cursor-pointer hover:border-slate-300 transition"
              >
                <option value="">All Languages</option>
                {uniqueLangs.map(l => <option key={l} value={l}>{LANG_FLAGS[l] || "🌐"} {(l || "?").toUpperCase()}</option>)}
              </select>
              <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">{filtered.length} shown</span>
            </div>
          </div>

          {filtered.length > 0 ? (
            <div className="space-y-2">
              {filtered.map((t) => (
                <TraceRow
                  key={t.id}
                  trace={t}
                  expanded={expandedTrace === t.id}
                  onToggle={() => setExpandedTrace(expandedTrace === t.id ? null : t.id)}
                  onCopy={() => copyTrace(t)}
                  copyId={copyId}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">🎙️</span>
              </div>
              <p className="text-slate-500 font-medium">No interactions yet</p>
              <p className="text-slate-400 text-xs mt-1">Start speaking to see data here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
