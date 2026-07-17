"use client";

import { useEffect } from "react";
import { lockNow } from "@/app/lock/actions";

const KEY = "applock:hiddenAt";

// Re-lock the PWA (back to the PIN) when it's been in the background / phone-locked for
// longer than `thresholdMs`. The unlock is a session cookie that survives a phone-lock
// (the app is only backgrounded, not closed), so this watcher covers that gap. A full app
// close already re-locks on its own (the session cookie clears). Only active when a PIN is set.
export function AutoLock({ enabled, thresholdMs = 300_000 }: { enabled: boolean; thresholdMs?: number }) {
  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        try { localStorage.setItem(KEY, String(Date.now())); } catch {}
        return;
      }
      // became visible → re-lock if we were away long enough
      let hiddenAt = 0;
      try { hiddenAt = Number(localStorage.getItem(KEY) || 0); localStorage.removeItem(KEY); } catch {}
      if (hiddenAt && Date.now() - hiddenAt > thresholdMs) void lockNow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    // Also cover a fresh mount that resumed from a long background without a visibility event.
    onVisibility();
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [enabled, thresholdMs]);
  return null;
}
