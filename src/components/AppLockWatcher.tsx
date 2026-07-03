"use client";

import { useEffect, useRef } from "react";
import { lockNow } from "@/app/lock/actions";

// Auto re-lock rules (only mounted when a household PIN is set):
//  • Foreground idle for 5 minutes → lock.
//  • App sent to the background (app-switch or phone lock) and returned after a
//    short grace → lock. This is what makes "phone locked → app locked" work.
const IDLE_MS = 5 * 60 * 1000;
const BACKGROUND_GRACE_MS = 30 * 1000;

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

    // Fresh app launch (e.g. cleared from recents): sessionStorage is wiped on full
    // termination, so a valid unlock cookie without this marker means a stale
    // session inherited across a close → force a re-lock. Set on unlock (LockScreen).
    if (sessionStorage.getItem("applock-live") !== "1") {
      lock();
      return;
    }
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

    const iv = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastActive.current > IDLE_MS) {
        lock();
      }
    }, 20_000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(iv);
    };
  }, []);

  return null;
}
