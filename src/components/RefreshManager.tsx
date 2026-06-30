"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Keeps each device fresh so family members see each other's edits:
//  • auto-refreshes when the app regains focus / becomes visible (debounced)
//  • a manual pull-to-refresh gesture at the top of the page (mobile)
// Server pages re-render with fresh DB data via router.refresh() (the SW serves
// navigations network-first, so the data is current).
export function RefreshManager() {
  const router = useRouter();
  const last = useRef(0);
  const pullRef = useRef(0);
  const [pulling, setPulling] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const doRefresh = useCallback(() => {
    const now = Date.now();
    if (now - last.current < 4000) return; // debounce
    last.current = now;
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 800);
  }, [router]);

  // auto-refresh on focus / tab becoming visible
  useEffect(() => {
    const onVis = () => document.visibilityState === "visible" && doRefresh();
    window.addEventListener("focus", doRefresh);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", doRefresh);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [doRefresh]);

  // pull-to-refresh (touch), only when the page is scrolled to the very top
  useEffect(() => {
    let startY = 0;
    let active = false;
    const top = () => (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0;

    const onStart = (e: TouchEvent) => {
      active = top();
      startY = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const dy = e.touches[0].clientY - startY;
      const v = dy > 0 ? Math.min(dy, 90) : 0;
      pullRef.current = v;
      setPulling(v);
    };
    const onEnd = () => {
      if (active && pullRef.current > 70) doRefresh();
      active = false;
      pullRef.current = 0;
      setPulling(0);
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, [doRefresh]);

  if (!refreshing && pulling === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex justify-center"
      style={{ opacity: refreshing ? 1 : Math.min(1, pulling / 70) }}
    >
      <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-medium text-slate-600 shadow">
        <span className={refreshing ? "inline-block animate-spin" : ""}>↻</span>
        {refreshing ? "Refreshing…" : pulling > 70 ? "Release to refresh" : "Pull to refresh"}
      </div>
    </div>
  );
}
