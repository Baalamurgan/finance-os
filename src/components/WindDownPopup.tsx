"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * A once-a-day modal nudge during the 5-day wind-down window. Shows on the first
 * app open of the day (i.e. right after the family passcode unlock lands you in
 * the app), so the head can't miss the month-end close. Separate per-day key from
 * the banner's dismiss, so dismissing the banner doesn't suppress the popup and
 * vice-versa. Push notifications are a later layer; this is the in-app cue.
 */
export function WindDownPopup({ daysUntil, day, q }: { daysUntil: number; day: number; q: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const key = `wd-popup-shown:${new Date().toDateString()}`;
    if (localStorage.getItem(key) !== "1") setShow(true);
  }, []);

  const close = () => {
    localStorage.setItem(`wd-popup-shown:${new Date().toDateString()}`, "1");
    setShow(false);
  };

  if (!show) return null;

  // Expected wind-down date = the close `day` on the nearest upcoming month (this month if
  // it hasn't passed, else next month) — a concrete date to show alongside the countdown.
  const now = new Date();
  let wdDate = new Date(now.getFullYear(), now.getMonth(), day);
  if (wdDate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) wdDate = new Date(now.getFullYear(), now.getMonth() + 1, day);
  const dateStr = wdDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  const due = daysUntil <= 0;
  const headline = due
    ? `Month-end wind-down is due today (${dateStr})`
    : `Month-end wind-down in ${daysUntil} day${daysUntil === 1 ? "" : "s"} (on ${dateStr})`;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4" onClick={close}>
      <div
        className="w-full max-w-sm rounded-t-3xl bg-white shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="px-6 pt-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-100 text-3xl">⏰</div>
          <h2 className="mt-3 text-lg font-bold text-slate-900">{headline}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            Log any pending spends before the month closes.
          </p>
        </div>
        <div className="flex flex-col gap-2 px-6 py-6">
          <Link
            href={`/wind-down${q}`}
            onClick={close}
            className="w-full rounded-xl bg-amber-600 px-4 py-3 text-center text-base font-semibold text-white hover:bg-amber-700"
          >
            Review wind-down →
          </Link>
          <button
            type="button"
            onClick={close}
            className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
          >
            Later today
          </button>
        </div>
      </div>
    </div>
  );
}
