"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatINR } from "@/lib/format";
import { buildBriefing, BRIEFING_OPTIONS, DEFAULT_BRIEFING_PREFS, type BriefingPrefs } from "@/lib/os/briefing";
import type { TaskWithList } from "@/lib/integrations/google/tasks";
import type { TodayItem } from "@/lib/os/timeline";

const PREFS_KEY = "briefing-prefs-v1";

// The "Good morning" hero — the landing element of Today. Tap it and the assistant reads your
// day aloud (browser speech synthesis) while the transcript reveals below. Everything spoken is
// derived deterministically from your data, so it works offline and before any AI is installed;
// a local LLM will later rephrase these same facts. The gear chooses what gets said.
export function GoodMorning({
  name,
  canSpend,
  tasks,
  items,
}: {
  name: string;
  canSpend: number | null;
  tasks: TaskWithList[];
  items: TodayItem[];
}) {
  const [prefs, setPrefs] = useState<BriefingPrefs>(DEFAULT_BRIEFING_PREFS);
  const [speaking, setSpeaking] = useState(false);
  const [open, setOpen] = useState(false); // transcript revealed
  const [settings, setSettings] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) setPrefs({ ...DEFAULT_BRIEFING_PREFS, ...JSON.parse(raw) });
    } catch {}
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); };
  }, []);

  const briefing = useMemo(() => buildBriefing({ name, canSpend, tasks, items }, prefs, new Date()), [name, canSpend, tasks, items, prefs]);

  const savePrefs = (p: BriefingPrefs) => {
    setPrefs(p);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
  };

  const stop = () => {
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  const speak = () => {
    setOpen(true);
    if (!supported) return; // no audio → just show the transcript
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(briefing.speech);
    u.lang = "en-IN";
    u.rate = 1;
    u.pitch = 1;
    const preferred = window.speechSynthesis.getVoices().find((v) => /en[-_](IN|GB|US)/i.test(v.lang));
    if (preferred) u.voice = preferred;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };

  const toggle = () => (speaking ? stop() : speak());

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 p-5 text-white shadow-sm">
      {/* soft glow */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight">{briefing.greeting}</h1>
          <p className="mt-0.5 text-sm text-emerald-50/80">
            {briefing.subtitle}
            {canSpend != null && <> · {formatINR(canSpend)} left</>}
          </p>
        </div>
        <button
          onClick={() => setSettings(true)}
          aria-label="Briefing settings"
          className="shrink-0 rounded-full bg-white/15 p-2 text-white/90 hover:bg-white/25"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.7" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="1.4" /></svg>
        </button>
      </div>

      {/* the big talk button */}
      <button
        onClick={toggle}
        className="relative mt-4 flex w-full items-center justify-center gap-2.5 rounded-full bg-white py-3.5 text-[15px] font-semibold text-emerald-700 shadow-sm active:scale-[0.99]"
      >
        {speaking ? (
          <>
            <EqualizerIcon /> Stop briefing
          </>
        ) : (
          <>
            <SpeakerIcon /> {supported ? "Good morning — hear my day" : "Good morning — show my day"}
          </>
        )}
      </button>

      {/* transcript */}
      {open && (
        <ul className="relative mt-4 space-y-2">
          {briefing.lines.map((l, i) => (
            <li key={i} className="flex items-start gap-2.5 rounded-lg bg-white/10 px-3 py-2 text-sm text-white/95">
              <span className="text-base leading-tight">{l.icon}</span>
              <span className="min-w-0">{l.text}</span>
            </li>
          ))}
          <li className="pt-1 text-center">
            <button onClick={() => setOpen(false)} className="text-xs font-medium text-emerald-50/70 hover:text-white">Hide</button>
          </li>
        </ul>
      )}

      {settings && <SettingsSheet prefs={prefs} onSave={savePrefs} onClose={() => setSettings(false)} supported={supported} />}
    </section>
  );
}

function SettingsSheet({ prefs, onSave, onClose, supported }: { prefs: BriefingPrefs; onSave: (p: BriefingPrefs) => void; onClose: () => void; supported: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white text-slate-900 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-bold">What should I tell you?</h2>
          <button onClick={onClose} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-3">
          {BRIEFING_OPTIONS.map((o) => (
            <label key={o.key} className="flex cursor-pointer items-start gap-3 py-2.5">
              <input
                type="checkbox"
                checked={prefs[o.key]}
                onChange={(e) => onSave({ ...prefs, [o.key]: e.target.checked })}
                className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-xs text-slate-400">{o.hint}</span>
              </span>
            </label>
          ))}
          {!supported && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              This browser can&apos;t speak aloud — you&apos;ll see the briefing as text. Try Chrome or Safari for voice.
            </p>
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
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M11 5 6 9H3v6h3l5 4V5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
  );
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
