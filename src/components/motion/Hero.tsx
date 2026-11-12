"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { reducedMotion } from "@/components/motion/live";

// "Shared element" zoom across a page change, without the browser's View Transitions (our loading
// skeleton sits between the two pages, which would break a native morph):
//   1. heroLaunch(key, el) on tap: a copy of the tapped element is pinned on top, exactly where it was,
//      and lifts slightly while the next page loads (it lives on <body>, so it survives the navigation).
//   2. <HeroTarget k={key}> on the next page: when it mounts, the copy flies to the target's spot and
//      fades while the target grows out of the copy's old spot — one object moving, not two swapping.
// If the target never shows (navigation failed, other page) the copy just fades out after a moment.

let flight: { key: string; clone: HTMLElement; timer: number } | null = null;

function land(f: NonNullable<typeof flight>, fade = true) {
  window.clearTimeout(f.timer);
  if (fade) {
    f.clone.style.transition = "opacity 0.2s ease";
    f.clone.style.opacity = "0";
    window.setTimeout(() => f.clone.remove(), 220);
  } else f.clone.remove();
  if (flight === f) flight = null;
}

/** `unflip`: the element is a card turned over (its first child is rotated) — turn it face-up in flight. */
export function heroLaunch(key: string, el: HTMLElement, opts: { unflip?: boolean } = {}) {
  if (typeof window === "undefined" || reducedMotion()) return;
  if (flight) land(flight, false);
  const r = el.getBoundingClientRect();
  const clone = el.cloneNode(true) as HTMLElement;
  clone.setAttribute("aria-hidden", "true");
  clone.querySelectorAll("a,button,[tabindex]").forEach((n) => n.setAttribute("tabindex", "-1"));
  Object.assign(clone.style, {
    position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    margin: "0", zIndex: "80", pointerEvents: "none", transformOrigin: "top left", opacity: "1",
    transition: "transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), filter 0.35s ease", perspective: "1200px",
  });
  document.body.appendChild(clone);
  // lift a touch while the next page loads
  requestAnimationFrame(() => {
    clone.style.transform = "translateY(-8px) scale(1.03)";
    clone.style.filter = "drop-shadow(0 24px 30px rgba(15,23,42,0.35))";
    if (opts.unflip) {
      const inner = clone.firstElementChild as HTMLElement | null;
      if (inner) inner.style.transform = "none"; // its own 0.6s turn-over transition does the flip
    }
  });
  const f = { key, clone, timer: 0 };
  f.timer = window.setTimeout(() => land(f), 4000);
  flight = f;
}

const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function HeroTarget({ k, children, className = "" }: { k: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useIsoLayout(() => {
    const f = flight;
    const el = ref.current;
    if (!f || f.key !== k || !el) return;
    window.clearTimeout(f.timer);
    const from = f.clone.getBoundingClientRect();
    const to = el.getBoundingClientRect();
    if (!to.width || !to.height) { land(f); return; }
    // target: start on top of the copy, then glide home
    const dx = from.left - to.left, dy = from.top - to.top;
    const sx = from.width / to.width, sy = from.height / to.height;
    el.style.transformOrigin = "top left";
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    el.style.opacity = "0";
    void el.offsetWidth; // commit the start position
    const ease = "cubic-bezier(0.22, 1, 0.36, 1)";
    el.style.transition = `transform 0.55s ${ease}, opacity 0.3s ease 0.1s`;
    el.style.transform = "none";
    el.style.opacity = "1";
    // copy: fly to the target and fade out
    // (its transform is measured from its pinned, untransformed box)
    const c = f.clone;
    const bx = parseFloat(c.style.left), by = parseFloat(c.style.top), bw = parseFloat(c.style.width), bh = parseFloat(c.style.height);
    c.style.transition = `transform 0.55s ${ease}, opacity 0.35s ease 0.15s, filter 0.35s ease`;
    c.style.transform = `translate(${to.left - bx}px, ${to.top - by}px) scale(${to.width / bw}, ${to.height / bh})`;
    c.style.filter = "none";
    c.style.opacity = "0";
    flight = null;
    // (no cleanup: this must finish even if React re-runs the effect — the flight is already claimed)
    window.setTimeout(() => { c.remove(); el.style.transition = ""; el.style.transform = ""; el.style.opacity = ""; el.style.transformOrigin = ""; }, 650);
  }, [k]);
  return <div ref={ref} className={className}>{children}</div>;
}
