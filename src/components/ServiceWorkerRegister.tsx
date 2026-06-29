"use client";

import { useEffect, useState } from "react";

// Registers the PWA service worker and surfaces a "new version available" toast
// when an updated SW is waiting — so family phones don't sit on a stale cached build.
export function ServiceWorkerRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return; // only register in prod builds

    let reg: ServiceWorkerRegistration | undefined;
    navigator.serviceWorker
      .register("/sw.js")
      .then((r) => {
        reg = r;
        if (r.waiting) setWaiting(r.waiting);
        r.addEventListener("updatefound", () => {
          const nw = r.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) setWaiting(nw);
          });
        });
      })
      .catch(() => {});

    // when the new SW takes control, reload once to get fresh assets
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  }, []);

  if (!waiting) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] flex items-center justify-between gap-3 bg-slate-900 px-4 py-3 text-sm text-white sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2 sm:rounded-lg sm:shadow-lg">
      <span>A new version is available.</span>
      <button
        onClick={() => waiting.postMessage("SKIP_WAITING")}
        className="rounded-md bg-indigo-500 px-3 py-1 font-medium hover:bg-indigo-400"
      >
        Refresh
      </button>
    </div>
  );
}
