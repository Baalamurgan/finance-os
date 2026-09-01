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
      // Pass the page they were on so unlocking returns them here, not to home.
      if (hiddenAt && Date.now() - hiddenAt > thresholdMs) void lockNow(window.location.pathname + window.location.search);
    };
    document.addEventListener("visibilitychange", onVisibility);
    // If this component is mounting, we're already visible AND past the lock screen (unlocked),
    // so only CLEAR any stale background marker — never re-lock here. Acting on a leftover
    // timestamp (from a previous session that was closed while backgrounded) bounced a fresh
    // unlock straight back to the PIN → the "enter the PIN twice" bug. Genuine background→
    // foreground re-locks still fire through the real visibilitychange event above.
    try { localStorage.removeItem(KEY); } catch {}
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [enabled, thresholdMs]);
  return null;
}
