"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Dismissible in-app reminder shown in the 5 days before the calendar month ends.
 * The month auto-closes on the 1st, so this is a heads-up to log pending spends and
 * add any remaining-balance expenses. Dismissal is per-day (re-appears the next day)
 * so nobody misses it. Push notifications are a later layer; this is the in-app cue.
 */
export function WindDownBanner({ daysUntil, monthLabel }: { daysUntil: number; monthLabel: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const key = `wd-banner-dismissed:${new Date().toDateString()}`;
    setShow(localStorage.getItem(key) !== "1");
  }, []);

  if (!show) return null;

  const dismiss = () => {
    localStorage.setItem(`wd-banner-dismissed:${new Date().toDateString()}`, "1");
    setShow(false);
  };

  const msg =
    daysUntil <= 0
      ? `${monthLabel} ends today.`
      : `${monthLabel} ends in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`;

  return (
    <div className="border-b border-amber-200 bg-amber-50 text-amber-900">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 text-sm sm:px-6">
        <span className="text-base leading-none">⏰</span>
        <span className="flex-1">
          <span className="font-medium">{msg}</span> Log any pending spends before it closes.
        </span>
        <Link
          href="/wind-down"
          className="whitespace-nowrap rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
        >
          Wind down →
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded-md px-1.5 py-1 text-amber-500 hover:bg-amber-100 hover:text-amber-700"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
