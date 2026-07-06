"use client";

import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";

const applyMode = (m: Mode) => {
  const dark = m === "dark" || (m === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
};

/** Cycles System → Light → Dark. System follows the OS and updates live. */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    const saved = (localStorage.getItem("theme") as Mode | null) ?? "system";
    setMode(saved);
  }, []);

  // when on "system", track live OS changes
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyMode("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  const set = (m: Mode) => {
    localStorage.setItem("theme", m);
    applyMode(m);
    setMode(m);
  };

  const nextOf: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
  const label = mode === "dark" ? "Dark" : mode === "light" ? "Light" : "System";

  return (
    <button
      onClick={() => set(nextOf[mode])}
      title={`Theme: ${label} — click for ${nextOf[mode]}`}
      aria-label={`Theme: ${label}. Click to switch.`}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:bg-slate-100"
    >
      {mode === "dark" ? <Moon /> : mode === "light" ? <Sun /> : <Auto />}
    </button>
  );
}

function Sun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function Moon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
function Auto() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}
