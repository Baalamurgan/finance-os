"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Remembers which <details data-persist="key"> sections are open/collapsed, so
// switching months (or reloading) keeps the same sections expanded. Re-applies
// after each navigation (searchParams change) since the server re-renders fresh
// <details> with their default state.
export function DetailsPersist() {
  const sp = useSearchParams();
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-persist]"));
    const cleanups: (() => void)[] = [];
    for (const el of els) {
      const key = `details:${el.dataset.persist}`;
      const saved = localStorage.getItem(key);
      if (saved !== null) el.open = saved === "1";
      const onToggle = () => localStorage.setItem(key, el.open ? "1" : "0");
      el.addEventListener("toggle", onToggle);
      cleanups.push(() => el.removeEventListener("toggle", onToggle));
    }
    return () => cleanups.forEach((fn) => fn());
  }, [sp]);
  return null;
}
