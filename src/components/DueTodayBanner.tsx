"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getMyDueTodaySteps, type MyDueStep } from "@/app/actions";
import { formatINR } from "@/lib/format";

// Dismissible, all-tabs banner nudging the current member about THEIR Money-plan steps that need
// action now (due today or overdue) in the working month. Dismissal is per-day (localStorage), so
// it re-surfaces the next day — a stand-in until real app notifications. Data comes from a client
// call (like BillDueHighAlert) so the header stays a pure client component.
export function DueTodayBanner() {
  const [data, setData] = useState<{ periodQ: string; steps: MyDueStep[] } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const key = `duetoday-dismissed:${new Date().toDateString()}`;
    if (localStorage.getItem(key) === "1") { setDismissed(true); return; }
    let alive = true;
    getMyDueTodaySteps().then((d) => { if (alive) setData(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (dismissed || !data || data.steps.length === 0) return null;

  const close = () => {
    localStorage.setItem(`duetoday-dismissed:${new Date().toDateString()}`, "1");
    setDismissed(true);
  };

  const n = data.steps.length;
  const anyOverdue = data.steps.some((s) => s.overdue);
  const preview = data.steps.slice(0, 2).map((s) => `${s.label} ${formatINR(s.amount)}`).join(", ");

  return (
    <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
      <div className="mx-auto flex max-w-5xl items-center gap-2">
        <span className="shrink-0">⏰</span>
        <div className="min-w-0 flex-1">
          <b>{n} payment{n > 1 ? "s" : ""} {anyOverdue ? "need action" : "due today"}</b>
          <span className="text-red-600"> · {preview}{n > 2 ? `, +${n - 2} more` : ""}</span>
        </div>
        <Link
          href={`/in-hand${data.periodQ}`}
          className="shrink-0 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
        >
          Money plan →
        </Link>
        <button type="button" onClick={close} className="shrink-0 rounded-md px-1.5 py-1 text-red-400 hover:text-red-600" aria-label="Dismiss">✕</button>
      </div>
    </div>
  );
}
