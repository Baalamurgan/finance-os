"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Rolls a money figure up to its value when a page opens (or from the old value to the new one when the
// month changes), so a headline number "lands" instead of just being there. It never changes WHAT is
// shown: it is handed the final text exactly as the page formatted it ("₹5,02,622", "-₹1,097.50") and
// always finishes on that exact text. Only the digits roll; ₹, signs, words and decimals stay put.
//   • The very first page load shows the final text straight away (no flash of the server-rendered value).
//   • Reduced motion: no rolling.

const seen: Record<string, number> = {}; // last value shown per `id`, so a month switch rolls old → new
let hydrated = false;
let flipQueued = false;

const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

function parse(text: string) {
  const m = text.match(/^(\D*?)(\d[\d,]*)(\.\d+)?(\D*)$/);
  if (!m) return null;
  const [, pre, int, frac = "", post] = m;
  const decimals = frac ? frac.length - 1 : 0;
  const value = Number(int.replace(/,/g, "") + frac);
  return Number.isFinite(value) ? { pre, post, decimals, value } : null;
}

const fmt = (n: number, decimals: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export function CountUp({ text, id, duration = 750, className }: { text: string; id?: string; duration?: number; className?: string }) {
  const [shown, setShown] = useState(text);
  const raf = useRef(0);
  const origin = useRef<{ text: string; from: number } | null>(null);

  useIsoLayout(() => {
    // Everything that mounts in the hydration commit sees hydrated === false; flip it right after.
    const live = hydrated;
    if (!hydrated && !flipQueued) { flipQueued = true; setTimeout(() => { hydrated = true; }, 0); }
    const p = parse(text);
    // Read the starting point once per value (dev Strict Mode runs this effect twice).
    if (origin.current?.text !== text) {
      origin.current = { text, from: id != null && seen[id] != null ? seen[id] : 0 };
      if (id != null && p) seen[id] = p.value;
    }
    const from = origin.current.from;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!p || !live || reduce || from === p.value || p.value === 0) { setShown(text); return; }
    const start = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 4);
    const at = (v: number) => `${p.pre}${fmt(v, p.decimals)}${p.post}`;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      if (t >= 1) { setShown(text); return; }
      setShown(at(from + (p.value - from) * ease(t)));
      raf.current = requestAnimationFrame(tick);
    };
    setShown(at(from));
    raf.current = requestAnimationFrame(tick);
    // rAF doesn't run in a background tab — make sure the real figure is there regardless.
    const done = window.setTimeout(() => { cancelAnimationFrame(raf.current); setShown(text); }, duration + 150);
    return () => { cancelAnimationFrame(raf.current); window.clearTimeout(done); };
  }, [text]);

  return <span className={`tabular-nums ${className ?? ""}`}>{shown}</span>;
}
