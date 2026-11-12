"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { mountedLive, reducedMotion } from "@/components/motion/live";

// Bars and rings that MOVE to their new value instead of starting over:
//   • first time a bar is seen → it grows in from the left (the usual fo-bar entrance)
//   • switching month / range (the page re-mounts) → it starts at the width it had last time and glides
//     to the new one, so you can see what changed
//   • data refresh while on the page (e.g. a spend was just added) → CSS width transition, live
// Values are remembered per `id` for the session (module memory, nothing stored).

const seenBar = new Map<string, number>();
const seenRing = new Map<string, number>();
const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export function MorphBar({ id, pct, className = "", delay = 0, style }: { id: string; pct: number; className?: string; delay?: number; style?: CSSProperties }) {
  const [shown, setShown] = useState(pct);
  const [mode, setMode] = useState<"grow" | "morph">("grow");
  const first = useRef(true);

  useIsoLayout(() => {
    const prev = seenBar.get(id);
    seenBar.set(id, pct);
    if (first.current) {
      first.current = false;
      const live = mountedLive();
      if (live && prev != null && Math.abs(prev - pct) > 0.05 && !reducedMotion()) {
        setMode("morph");
        setShown(prev);
        const t = window.setTimeout(() => setShown(pct), 30);
        return () => window.clearTimeout(t);
      }
    }
    setShown(pct);
  }, [id, pct]);

  return (
    <div
      className={`${mode === "grow" ? "fo-bar" : ""} ${className}`}
      style={{
        ...style,
        width: `${shown}%`,
        transition: `width 0.8s ${EASE} ${mode === "morph" ? delay : 0}ms`,
        // .fo-over adds a wobble after the fill: keep its own delay after the grow
        animationDelay: mode === "grow" ? (className.includes("fo-over") ? `${delay}ms, ${delay + 950}ms` : `${delay}ms`) : undefined,
      }}
    />
  );
}

/** Savings ring: draws in the first time; afterwards sweeps from the last value to the new one. */
export function MorphRing({ id, fill, len, color }: { id: string; fill: number; len: number; color: string }) {
  const off = (f: number) => len * (1 - Math.max(0, Math.min(100, f)) / 100);
  const [shown, setShown] = useState(fill);
  const [mode, setMode] = useState<"draw" | "morph">("draw");
  const first = useRef(true);

  useIsoLayout(() => {
    const prev = seenRing.get(id);
    seenRing.set(id, fill);
    if (first.current) {
      first.current = false;
      if (mountedLive() && prev != null && Math.abs(prev - fill) > 0.05 && !reducedMotion()) {
        setMode("morph");
        setShown(prev);
        const t = window.setTimeout(() => setShown(fill), 30);
        return () => window.clearTimeout(t);
      }
    }
    setShown(fill);
  }, [id, fill]);

  return (
    <circle
      cx="38" cy="38" r={30} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
      strokeDasharray={len} strokeDashoffset={off(shown)}
      className={mode === "draw" ? "fo-ring" : ""}
      style={{ ["--fo-ring-len" as string]: `${len}`, transition: `stroke-dashoffset 0.9s ${EASE}`, opacity: shown <= 0 && fill <= 0 ? 0 : 1 }}
    />
  );
}
