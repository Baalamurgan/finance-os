"use client";

import { useEffect, useState } from "react";
import { lockNow } from "@/app/lock/actions";

const KEY = "applock:hiddenAt";

// Auto-lock the app back to the PIN — built for a sensitive finance PWA. Three behaviours:
//  1. IDLE (foreground): after `thresholdMs` with no interaction the app locks ON ITS OWN — you
//     don't have to re-open the tab for it to trigger. A running timer, reset on any interaction.
//  2. BACKGROUND privacy: the moment the tab is hidden (app switched / phone locked) an opaque cover
//     drops over the screen so the OS "recent apps" snapshot doesn't leak balances. Best-effort on
//     web — a browser tab can't set a secure/no-snapshot flag the way a native app can, so covering
//     on the hidden event is the standard mitigation.
//  3. AWAY: on return, if we were backgrounded longer than the threshold, lock. (Background tabs
//     freeze their timers, so the idle timer can't run there — this covers that gap.)
// Only active when a PIN is set.
export function AutoLock({ enabled, thresholdMs = 300_000 }: { enabled: boolean; thresholdMs?: number }) {
  const [covered, setCovered] = useState(false);

  useEffect(() => {
    if (!enabled) return;
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

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        setCovered(true); // hide the screen before the app-switcher snapshot is taken
        if (timer) clearTimeout(timer); // timers freeze in the background anyway
        try { localStorage.setItem(KEY, String(Date.now())); } catch {}
        return;
      }
      // back in foreground → lock if we were away too long, otherwise uncover + restart the countdown
      let hiddenAt = 0;
      try { hiddenAt = Number(localStorage.getItem(KEY) || 0); localStorage.removeItem(KEY); } catch {}
      if (hiddenAt && Date.now() - hiddenAt > thresholdMs) { lock(); return; }
      setCovered(false);
      lastReset = 0;
      resetIdle();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Start the countdown now (we're foregrounded & unlocked on mount). Only CLEAR any stale
    // background marker here — never act on it: acting on a leftover timestamp (from a session
    // closed while backgrounded) bounced a fresh unlock straight back to the PIN → the
    // "enter the PIN twice" bug. Genuine background→foreground re-locks fire via visibilitychange.
    resetIdle();
    try { localStorage.removeItem(KEY); } catch {}

    return () => {
      if (timer) clearTimeout(timer);
      for (const e of activity) window.removeEventListener(e, resetIdle, { capture: true } as EventListenerOptions);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, thresholdMs]);

  if (!covered) return null;
  // Opaque privacy cover — sits above everything (modals included) so a backgrounded snapshot shows
  // this, not the balances behind it.
  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-3 bg-slate-900 text-white"
    >
      <div className="text-4xl">🔒</div>
      <div className="text-xs font-medium uppercase tracking-widest text-slate-400">Family Finance OS</div>
    </div>
  );
}
