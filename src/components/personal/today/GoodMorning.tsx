"use client";

import { useEffect, useMemo, useState } from "react";
import { formatINR } from "@/lib/format";
import { buildBriefing, BRIEFING_OPTIONS, DEFAULT_BRIEFING_PREFS, type BriefEvent, type BriefingPrefs } from "@/lib/os/briefing";
import type { TaskWithList } from "@/lib/integrations/google/tasks";
import type { TodayItem } from "@/lib/os/timeline";

const PREFS_KEY = "briefing-prefs-v1";
const VOICE_KEY = "briefing-voice-v1";

// The "Good morning" hero — the landing element of Today. Tap it and the assistant reads your
// day aloud (browser speech synthesis) while the transcript reveals below; tap any line to start
// reading from there. Everything spoken is derived deterministically from your data, so it works
// offline and before any AI; a local LLM will later rephrase these same facts. The gear chooses
// what gets said and which device voice to use.
export function GoodMorning({
  name,
  canSpend,
  tasks,
  events,
  items,
}: {
  name: string;
  canSpend: number | null;
  tasks: TaskWithList[];
  events: BriefEvent[];
  items: TodayItem[];
}) {
  const [prefs, setPrefs] = useState<BriefingPrefs>(DEFAULT_BRIEFING_PREFS);
  const [speaking, setSpeaking] = useState(false);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [open, setOpen] = useState(false); // transcript revealed
  const [settings, setSettings] = useState(false);
  const [supported, setSupported] = useState(true);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState<string>("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) setPrefs({ ...DEFAULT_BRIEFING_PREFS, ...JSON.parse(raw) });
      setVoiceURI(localStorage.getItem(VOICE_KEY) ?? "");
    } catch {}
    const has = typeof window !== "undefined" && "speechSynthesis" in window;
    setSupported(has);
    if (!has) return;
    const load = () => setVoices(window.speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)));
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
    };
  }, []);

  const briefing = useMemo(() => buildBriefing({ name, canSpend, tasks, events, items }, prefs, new Date()), [name, canSpend, tasks, events, items, prefs]);

  const savePrefs = (p: BriefingPrefs) => {
    setPrefs(p);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
  };
  const saveVoice = (uri: string) => {
    setVoiceURI(uri);
    try { localStorage.setItem(VOICE_KEY, uri); } catch {}
  };

  const stop = () => {
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
    setActiveLine(null);
  };

  const say = (text: string, line: number | null) => {
    setOpen(true);
    if (!supported) return; // no audio → just reveal the transcript
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const chosen = voices.find((v) => v.voiceURI === voiceURI) ?? voices.find((v) => /en[-_](IN|GB|US)/i.test(v.lang)) ?? voices[0];
    if (chosen) { u.voice = chosen; u.lang = chosen.lang; } else u.lang = "en-IN";
    u.rate = 1.03; // a touch quicker + warmer than the flat default
    u.pitch = 1.08;
    u.onend = () => { setSpeaking(false); setActiveLine(null); };
    u.onerror = () => { setSpeaking(false); setActiveLine(null); };
    setSpeaking(true);
    setActiveLine(line);
    window.speechSynthesis.speak(u);
  };

  // Play the whole briefing, or start from a tapped line through to the end.
  const playAll = () => (speaking ? stop() : say(briefing.speech, null));
  const playFrom = (i: number) => say([...briefing.lines.slice(i).map((l) => l.speech), briefing.outro].join(" "), i);

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 p-5 text-white shadow-sm">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight">{briefing.greeting}</h1>
          <p className="mt-0.5 text-sm text-emerald-50/80">
            {briefing.subtitle}
            {canSpend != null && <> · {formatINR(canSpend)} left</>}
          </p>
        </div>
        <button onClick={() => setSettings(true)} aria-label="Briefing settings" className="shrink-0 rounded-full bg-white/15 p-2 text-white/90 hover:bg-white/25">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.7" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="1.4" /></svg>
        </button>
      </div>

      <button onClick={playAll} className="relative mt-4 flex w-full items-center justify-center gap-2.5 rounded-full bg-white py-3.5 text-[15px] font-semibold text-emerald-700 shadow-sm active:scale-[0.99]">
        {speaking ? (<><EqualizerIcon /> Stop</>) : (<><SpeakerIcon /> {supported ? "Good morning — hear my day" : "Good morning — show my day"}</>)}
      </button>

      {open && (
        <ul className="relative mt-4 space-y-2">
          {briefing.lines.map((l, i) => (
            <li key={i}>
              <button
                onClick={() => playFrom(i)}
                className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition ${activeLine === i ? "bg-white/25 text-white" : "bg-white/10 text-white/95 hover:bg-white/20"}`}
              >
                <span className="text-base leading-tight">{l.icon}</span>
                <span className="min-w-0 flex-1">{l.text}</span>
                {supported && <span className={`mt-0.5 shrink-0 ${activeLine === i ? "opacity-100" : "opacity-40"}`}><MiniSpeaker /></span>}
              </button>
            </li>
          ))}
          <li className="pt-1 text-center">
            <button onClick={() => { stop(); setOpen(false); }} className="text-xs font-medium text-emerald-50/70 hover:text-white">Hide</button>
          </li>
        </ul>
      )}

      {settings && (
        <SettingsSheet
          prefs={prefs}
          onSave={savePrefs}
          onClose={() => setSettings(false)}
          supported={supported}
          voices={voices}
          voiceURI={voiceURI}
          onVoice={saveVoice}
          onPreview={() => say("Hey! Here's a quick preview of how I'll sound.", null)}
        />
      )}
    </section>
  );
}

function SettingsSheet({ prefs, onSave, onClose, supported, voices, voiceURI, onVoice, onPreview }: {
  prefs: BriefingPrefs; onSave: (p: BriefingPrefs) => void; onClose: () => void; supported: boolean;
  voices: SpeechSynthesisVoice[]; voiceURI: string; onVoice: (uri: string) => void; onPreview: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white text-slate-900 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-bold">Your morning briefing</h2>
          <button onClick={onClose} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">What should I tell you?</p>
          {BRIEFING_OPTIONS.map((o) => (
            <label key={o.key} className="flex cursor-pointer items-start gap-3 py-2.5">
              <input type="checkbox" checked={prefs[o.key]} onChange={(e) => onSave({ ...prefs, [o.key]: e.target.checked })} className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-xs text-slate-400">{o.hint}</span>
              </span>
            </label>
          ))}

          {supported ? (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Voice</p>
              <div className="mt-2 flex items-center gap-2">
                <select value={voiceURI} onChange={(e) => onVoice(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none">
                  <option value="">Device default</option>
                  {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
                </select>
                <button onClick={onPreview} className="shrink-0 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100">Preview</button>
              </div>
              <p className="mt-1.5 text-xs text-slate-400">Voices come from your phone/browser. Pick the friendliest one — a warmer AI voice can come later.</p>
            </div>
          ) : (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">This browser can&apos;t speak aloud — you&apos;ll see the briefing as text. Try Chrome or Safari for voice.</p>
          )}
        </div>
        <div className="border-t border-slate-100 px-5 py-3">
          <button onClick={onClose} className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">Done</button>
        </div>
      </div>
    </div>
  );
}

function SpeakerIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M11 5 6 9H3v6h3l5 4V5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}
function MiniSpeaker() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M11 5 6 9H3v6h3l5 4V5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M15.5 9a4 4 0 0 1 0 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}
function EqualizerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="9" width="3" height="6" rx="1.5" fill="currentColor"><animate attributeName="height" values="6;14;6" dur="0.8s" repeatCount="indefinite" /><animate attributeName="y" values="9;5;9" dur="0.8s" repeatCount="indefinite" /></rect>
      <rect x="10.5" y="6" width="3" height="12" rx="1.5" fill="currentColor"><animate attributeName="height" values="12;4;12" dur="0.8s" repeatCount="indefinite" /><animate attributeName="y" values="6;10;6" dur="0.8s" repeatCount="indefinite" /></rect>
      <rect x="17" y="9" width="3" height="6" rx="1.5" fill="currentColor"><animate attributeName="height" values="6;14;6" dur="0.9s" repeatCount="indefinite" /><animate attributeName="y" values="9;5;9" dur="0.9s" repeatCount="indefinite" /></rect>
    </svg>
  );
}
