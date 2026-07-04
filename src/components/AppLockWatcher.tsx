"use client";

import { useEffect, useRef } from "react";
import { lockNow } from "@/app/lock/actions";

// Auto re-lock rules (only mounted when a household PIN is set):
//  • Foreground idle for 5 minutes → lock.
//  • App sent to the background (app-switch or phone lock) and returned after a
//    short grace → lock. This is what makes "phone locked → app locked" work.
//  • Cold start after the app was closed for a while → lock (see heartbeat below).
const IDLE_MS = 5 * 60 * 1000;
const BACKGROUND_GRACE_MS = 30 * 1000;

// "Alive" heartbeat: we stamp localStorage while the app is open (and on unlock).
// On mount, if the last stamp is older than this, the app was effectively closed
// (e.g. cleared from recents) → re-lock. This can't loop because a successful
// unlock writes a FRESH stamp, so the very next mount sees a recent heartbeat.
const HEARTBEAT_KEY = "applock-hb";
const COLD_START_MS = 30 * 1000;

// Stamp the "alive" heartbeat. Call this on a successful unlock / PIN set so the
// cold-start check sees a recent timestamp and doesn't immediately re-lock.
export function markAlive() {
  try {
    localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
  } catch {
    /* storage unavailable — ignore */
  }
}

export function AppLockWatcher() {
  const lastActive = useRef(Date.now());
  const hiddenAt = useRef<number | null>(null);
  const locking = useRef(false);

  useEffect(() => {
    const lock = () => {
      if (locking.current) return;
      locking.current = true;
      // clears the unlock cookie server-side and redirects to /lock
      void lockNow();
    };

    // Cold-start detection. Fail OPEN on any storage error so we can never trap
    // the user at the lock screen.
    try {
      const last = Number(localStorage.getItem(HEARTBEAT_KEY) || 0);
      if (last && Date.now() - last > COLD_START_MS) {
        lock();
        return;
      }
    } catch {
      /* ignore */
    }
    markAlive();

    const bump = () => {
      lastActive.current = Date.now();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      if (away > BACKGROUND_GRACE_MS || Date.now() - lastActive.current > IDLE_MS) lock();
      else bump();
    };

    const events = ["pointerdown", "keydown", "touchstart", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);

    // keep the heartbeat fresh + catch foreground idle
    const iv = setInterval(() => {
      markAlive();
      if (document.visibilityState === "visible" && Date.now() - lastActive.current > IDLE_MS) {
        lock();
      }
    }, 15_000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(iv);
    };
  }, []);

  return null;
}
