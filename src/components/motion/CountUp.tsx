"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { mountedLive, reducedMotion } from "@/components/motion/live";

// Headline money figures roll like an odometer: each digit spins on its own wheel up to its value when a
// page opens (or from the old figure to the new one when the month changes / the data refreshes). It never
// changes WHAT is shown: it is handed the final text exactly as the page formatted it ("₹5,02,622",
// "-₹1,097.50") and always lands on that exact text. ₹, signs, commas and words stay put; only digits spin.
//   • Layout never shifts: every wheel sits over an invisible copy of its final digit (same width/baseline).
//   • The first page load shows the final text straight away (no flash of the server-rendered value).
//   • Reduced motion: no rolling.

const seen: Record<string, number> = {}; // last value shown per `id`, so a month switch rolls old → new

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

const DIGITS = Array.from({ length: 20 }, (_, i) => i % 10); // two turns of the wheel

/** `onlyChanges`: never roll in from 0 on mount — only roll when the value changes while it's on screen
 *  (list rows, where rolling every row on every page open would be noise). */
export function CountUp({ text, id, duration = 900, className, onlyChanges = false }: { text: string; id?: string; duration?: number; className?: string; onlyChanges?: boolean }) {
  // null = plain final text; otherwise the digits we roll FROM (right-aligned against the final digits)
  const [from, setFrom] = useState<number[] | null>(null);
  const [run, setRun] = useState(false);
  const last = useRef<number | null>(null); // previous value this instance showed (data refresh while mounted)
  const origin = useRef<{ text: string; from: number | null } | null>(null);

  useIsoLayout(() => {
    const live = mountedLive();
    const p = parse(text);
    // Read the starting point once per value (dev Strict Mode runs this effect twice).
    if (origin.current?.text !== text) {
      const prior = last.current ?? (id != null ? seen[id] : undefined);
      origin.current = { text, from: prior ?? (live && !onlyChanges ? 0 : null) };
      if (p) {
        last.current = p.value;
        if (id != null) seen[id] = p.value;
      }
    }
    const start = origin.current.from;
    if (!p || start == null || start === p.value || reducedMotion()) { setFrom(null); setRun(false); return; }
    const startDigits = fmt(Math.abs(start), p.decimals).replace(/\D/g, "").split("").map(Number);
    setFrom(startDigits);
    setRun(false);
    // next frame-ish (setTimeout, not rAF — rAF stalls in a background tab): spin to the final digits
    const go = window.setTimeout(() => setRun(true), 30);
    const done = window.setTimeout(() => { setFrom(null); setRun(false); }, duration + 600);
    return () => { window.clearTimeout(go); window.clearTimeout(done); };
  }, [text]);

  if (!from) return <span className={`tabular-nums ${className ?? ""}`}>{text}</span>;

  const chars = text.split("");
  const totalDigits = chars.filter((c) => c >= "0" && c <= "9").length;
  let seenDigits = 0;
  return (
    <span className={`tabular-nums ${className ?? ""}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {chars.map((c, i) => {
          if (c < "0" || c > "9") return <span key={i}>{c}</span>;
          const d = Number(c);
          const fromRight = totalDigits - 1 - seenDigits;
          const idx = seenDigits++;
          const s = from[from.length - 1 - fromRight] ?? 0;
          const end = d >= s ? d : d + 10; // always roll forward, the shortest way
          const at = run ? end : s;
          return (
            <span key={i} className="relative inline-block [clip-path:inset(0)]">
              <span className="invisible">{c}</span>
              <span
                className="absolute inset-x-0 top-0 flex flex-col"
                style={{
                  transform: `translateY(${-at * 5}%)`,
                  transition: run ? `transform ${duration}ms cubic-bezier(0.16, 1, 0.3, 1) ${idx * 40}ms` : "none",
                }}
              >
                {DIGITS.map((n, k) => <span key={k} className="block text-center">{n}</span>)}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
