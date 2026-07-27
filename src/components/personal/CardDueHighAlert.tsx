"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getMyCardHighAlerts, type CardHighAlert } from "@/app/personal/actions";

// High-alert popup: a member's credit-card bill due within 3 days (or overdue). Fires once
// a day, right after unlock, in BOTH family and personal views. Fetches its own data on
// mount (only if not already shown today) so no page needs to thread props. Amount-free in
// family view — the personal PIN still guards the detail.
export function CardDueHighAlert({ context }: { context: "family" | "personal" }) {
  const [alerts, setAlerts] = useState<CardHighAlert[] | null>(null);

  useEffect(() => {
    const key = `cc-highalert-shown:${new Date().toDateString()}`;
    if (localStorage.getItem(key) === "1") return;
    let alive = true;
    getMyCardHighAlerts().then((a) => {
      if (alive && a.length > 0) setAlerts(a);
    });
    return () => { alive = false; };
  }, []);

  if (!alerts || alerts.length === 0) return null;

  const close = () => {
    localStorage.setItem(`cc-highalert-shown:${new Date().toDateString()}`, "1");
    setAlerts(null);
  };

  const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const worst = alerts.reduce((a, b) => (a.daysUntilDue <= b.daysUntilDue ? a : b));
  const headline = worst.overdue
    ? "A credit-card bill is overdue"
    : worst.daysUntilDue === 0
      ? "A credit-card bill is due today"
      : `A credit-card bill is due in ${worst.daysUntilDue} day${worst.daysUntilDue === 1 ? "" : "s"}`;
  const href = context === "personal" ? "/personal/finance?tab=cards" : "/personal";

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4" onClick={close}>
      <div
        className="w-full max-w-sm rounded-t-3xl bg-white shadow-xl ring-2 ring-red-400 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="px-6 pt-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-red-100 text-3xl">🚨</div>
          <h2 className="mt-3 text-lg font-bold text-red-700">{headline}</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {alerts.map((a, i) => (
              <li key={i}>
                <b className="text-slate-800">{a.cardName}</b> —{" "}
                {a.overdue ? `overdue (was due ${fmt(a.dueISO)})` : `due ${fmt(a.dueISO)}`}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">Pay it to avoid interest &amp; late fees.</p>
        </div>
        <div className="flex flex-col gap-2 px-6 py-6">
          <Link
            href={href}
            onClick={close}
            className="w-full rounded-xl bg-red-600 px-4 py-3 text-center text-base font-semibold text-white hover:bg-red-700"
          >
            {context === "personal" ? "Go to cards →" : "Open Personal →"}
          </Link>
          <button type="button" onClick={close} className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100">
            Dismiss for today
          </button>
        </div>
      </div>
    </div>
  );
}
