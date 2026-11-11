"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// A thin progress line across the top while a tab / month loads — instant feedback on tap, so a switch
// reads as "on its way" rather than "stuck". It starts on any in-app link tap (or startNavProgress() for
// router.replace calls like the month picker) and finishes when the new page is really on screen: when
// the URL changes with no loading skeleton showing, or when the skeleton gives way to the page.

const START = "fo:nav-start";
const DONE = "fo:nav-done";
let skeletons = 0;

/** Start the line for a navigation that isn't a plain link tap (router.push/replace). */
export function startNavProgress() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(START));
}

/** Loading skeletons call this: while one is on screen the page isn't there yet; when it leaves, it is. */
export function useNavSkeleton() {
  useEffect(() => {
    skeletons++;
    return () => {
      skeletons = Math.max(0, skeletons - 1);
      if (skeletons === 0) window.dispatchEvent(new Event(DONE));
    };
  }, []);
}

type Phase = "idle" | "start" | "grow" | "finish";

export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [phase, setPhase] = useState<Phase>("idle");
  const running = useRef(false);
  const timers = useRef<number[]>([]);
  const first = useRef(true);

  const clear = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };

  const finish = () => {
    if (!running.current) return;
    running.current = false;
    clear();
    setPhase("finish");
    timers.current.push(window.setTimeout(() => setPhase("idle"), 450));
  };

  const start = () => {
    clear();
    running.current = true;
    setPhase("start");
    // next frame: let it grow (fast at first, then crawling — it never "arrives" before the page does)
    // (a short timer, not requestAnimationFrame: rAF pauses in a background tab and would leave it stuck)
    timers.current.push(window.setTimeout(() => running.current && setPhase("grow"), 30));
    timers.current.push(window.setTimeout(finish, 12000)); // failsafe
  };

  // Keep the latest closures for the listeners below.
  const api = useRef({ start, finish });
  useEffect(() => { api.current = { start, finish }; });

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same page / hash
      api.current.start();
    };
    const onStart = () => api.current.start();
    const onDone = () => api.current.finish();
    document.addEventListener("click", onClick, true);
    window.addEventListener(START, onStart);
    window.addEventListener(DONE, onDone);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(START, onStart);
      window.removeEventListener(DONE, onDone);
    };
  }, []);

  // URL changed: if no skeleton took over, the new page is already here → finish. (A skeleton finishes it
  // when it unmounts instead.) Checked a tick later so a skeleton mounting in the same commit counts.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = window.setTimeout(() => { if (skeletons === 0) api.current.finish(); }, 0);
    return () => window.clearTimeout(t);
  }, [pathname, search]);

  useEffect(() => () => clear(), []);

  if (phase === "idle") return null;
  const style: React.CSSProperties =
    phase === "start"
      ? { transform: "scaleX(0.04)", opacity: 1 }
      : phase === "grow"
        ? { transform: "scaleX(0.82)", opacity: 1, transition: "transform 8s cubic-bezier(0.08, 0.7, 0.2, 1)" }
        : { transform: "scaleX(1)", opacity: 0, transition: "transform 0.2s ease-out, opacity 0.3s ease 0.15s" };
  return <div aria-hidden className="fo-progress" data-tone={pathname.startsWith("/personal") ? "personal" : undefined} style={style} />;
}
