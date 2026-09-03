"use client";

import { useEffect, useRef } from "react";
import { lockNow } from "@/app/lock/actions";

const KEY = "applock:hiddenAt";

// Auto-lock the app back to the PIN — built for a sensitive finance PWA. Three behaviours:
//  1. IDLE (foreground): after `thresholdMs` with no interaction the app locks ON ITS OWN — a
//     running timer, reset on any interaction; no need to re-open the tab.
//  2. BACKGROUND privacy: the instant the app goes to the background, an opaque 🔒 cover is dropped
//     over the screen so the OS "recent apps" snapshot doesn't leak balances. The cover is toggled
//     IMPERATIVELY (direct DOM), NOT via React state — React re-renders asynchronously, so the OS
//     snapshots the real screen before the cover would ever paint. We also hook the earliest signals
//     (blur / pagehide), not just visibilitychange, to beat the snapshot. Best-effort: a browser tab
//     still can't set a native no-snapshot flag, but this is the strongest a PWA can do.
//  3. AWAY: on return, if we were backgrounded longer than the threshold, lock. (Background tabs
//     freeze their timers, so the idle timer can't run there — this covers that gap.)
// Only active when a PIN is set.
export function AutoLock({ enabled, thresholdMs = 300_000 }: { enabled: boolean; thresholdMs?: number }) {
  const coverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const cover = coverRef.current;
    const showCover = () => { if (cover) cover.style.display = "flex"; };
    const hideCover = () => { if (cover) cover.style.display = "none"; };

    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastReset = 0;
    const lock = () => void lockNow(window.location.pathname + window.location.search);
    const resetIdle = () => {
      const now = Date.now();
      if (timer && now - lastReset < 1000) return; // throttle chatty events (pointermove/scroll)
      lastReset = now;
      if (timer) clearTimeout(timer);
      timer = setTimeout(lock, thresholdMs);
    };

    // Any interaction restarts the idle countdown. Capture phase so it fires even for non-bubbling
    // events (scroll) and inner scroll containers.
    const activity = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel", "scroll"];
    for (const e of activity) window.addEventListener(e, resetIdle, { passive: true, capture: true });

    // Cover the screen ASAP when backgrounding. Cover here is imperative + synchronous so it can make
    // it into the OS snapshot; we also mark the away timestamp.
    const onBackground = () => {
      showCover();
      if (timer) clearTimeout(timer); // timers freeze in the background anyway
      try { localStorage.setItem(KEY, String(Date.now())); } catch {}
    };
    const onForeground = () => {
      let hiddenAt = 0;
      try { hiddenAt = Number(localStorage.getItem(KEY) || 0); localStorage.removeItem(KEY); } catch {}
      if (hiddenAt && Date.now() - hiddenAt > thresholdMs) { lock(); return; } // stays covered → /lock
      hideCover();
      lastReset = 0;
      resetIdle();
    };

    const onVisibility = () => { if (document.visibilityState === "hidden") onBackground(); else onForeground(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", showCover);
    window.addEventListener("pageshow", hideCover);
    // In the installed PWA, `blur` is the earliest background signal (fires before visibilitychange),
    // giving the best chance of painting the cover before the snapshot. Gate to standalone so a
    // desktop <select> / URL-bar focus change doesn't flash the cover in a normal browser tab.
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) {
      window.addEventListener("blur", showCover);
      window.addEventListener("focus", hideCover);
    }

    // Start the countdown (foregrounded & unlocked on mount) and ensure the cover is hidden. Only
    // CLEAR any stale background marker here — never act on it: acting on a leftover timestamp
    // (from a session closed while backgrounded) bounced a fresh unlock back to the PIN → the
    // "enter the PIN twice" bug. Genuine background→foreground re-locks fire via visibilitychange.
    hideCover();
    resetIdle();
    try { localStorage.removeItem(KEY); } catch {}

    return () => {
      if (timer) clearTimeout(timer);
      for (const e of activity) window.removeEventListener(e, resetIdle, { capture: true } as EventListenerOptions);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", showCover);
      window.removeEventListener("pageshow", hideCover);
      window.removeEventListener("blur", showCover);
      window.removeEventListener("focus", hideCover);
    };
  }, [enabled, thresholdMs]);

  // Always in the DOM (hidden by default) so it can be revealed synchronously — no React re-render
  // between "app backgrounded" and "cover shown". Sits above everything (modals included).
  return (
    <div
      ref={coverRef}
      aria-hidden
      style={{ display: "none" }}
      className="fixed inset-0 z-[9999] flex-col items-center justify-center gap-3 bg-slate-900 text-white"
    >
      <div className="text-4xl">🔒</div>
      <div className="text-xs font-medium uppercase tracking-widest text-slate-400">Family Finance OS</div>
    </div>
  );
}
