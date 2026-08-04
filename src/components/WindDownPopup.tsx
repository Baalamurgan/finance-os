"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * A once-a-day modal nudge in the 5 days before the calendar month ends. Shows on the
 * first app open of the day (right after the family passcode unlock), so the family logs
 * any pending spends + adds remaining-balance expenses before the month auto-closes on the
 * 1st. Separate per-day key from the banner's dismiss, so dismissing one doesn't suppress
 * the other. Push notifications are a later layer; this is the in-app cue.
 */
export function WindDownPopup({ daysUntil, day, monthLabel, q }: { daysUntil: number; day: number; monthLabel: string; q: string }) {
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

  // Month-end date = the last `day` (28–31) of the current month — a concrete date shown
  // alongside the countdown (e.g. "on 31 Aug").
  const now = new Date();
  const endDate = new Date(now.getFullYear(), now.getMonth(), day);
  const dateStr = endDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  const due = daysUntil <= 0;
  const headline = due
    ? `${monthLabel} ends today (${dateStr})`
    : `${monthLabel} ends in ${daysUntil} day${daysUntil === 1 ? "" : "s"} (on ${dateStr})`;

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
            href={`/expenses${q}`}
            onClick={close}
            className="w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-center text-base font-semibold text-amber-800 hover:bg-amber-100"
          >
            Add pending expenses →
          </Link>
          <Link
            href={`/wind-down${q}`}
            onClick={close}
            className="w-full rounded-xl bg-amber-600 px-4 py-3 text-center text-base font-semibold text-white hover:bg-amber-700"
          >
            Wind down early →
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
