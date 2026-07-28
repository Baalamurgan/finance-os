"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getMyBillReminders, type MyBillReminder } from "@/app/actions";
import { formatINR } from "@/lib/format";

// High-alert popup: a household bill due within 3 days (or overdue) that this member is
// responsible for — or that they're the head / a manager of. Fires once a day, right after
// unlock. Keeps nagging every day until the bill is marked paid. Mirrors the CC alert.
export function BillDueHighAlert() {
  const [bills, setBills] = useState<MyBillReminder[] | null>(null);

  useEffect(() => {
    const key = `bill-highalert-shown:${new Date().toDateString()}`;
    if (localStorage.getItem(key) === "1") return;
    let alive = true;
    getMyBillReminders().then((b) => {
      if (alive && b.length > 0) setBills(b);
    });
    return () => { alive = false; };
  }, []);

  if (!bills || bills.length === 0) return null;

  const close = () => {
    localStorage.setItem(`bill-highalert-shown:${new Date().toDateString()}`, "1");
    setBills(null);
  };

  const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const worst = bills.reduce((a, b) => (a.daysUntilDue <= b.daysUntilDue ? a : b));
  const anyOverdue = bills.some((b) => b.overdue);
  const headline = worst.overdue
    ? bills.length > 1 ? "Bills are overdue" : "A bill is overdue"
    : worst.daysUntilDue === 0
      ? "A bill is due today"
      : `A bill is due in ${worst.daysUntilDue} day${worst.daysUntilDue === 1 ? "" : "s"}`;

  return (
    <div className="fixed inset-0 z-[94] flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4" onClick={close}>
      <div
        className="w-full max-w-sm rounded-t-3xl bg-white shadow-xl ring-2 ring-amber-400 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="px-6 pt-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-100 text-3xl">🔔</div>
          <h2 className={`mt-3 text-lg font-bold ${anyOverdue ? "text-red-700" : "text-amber-700"}`}>{headline}</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {bills.map((b) => (
              <li key={b.categoryId}>
                <b className="text-slate-800">{b.name}</b>
                {b.amount != null ? ` · ${formatINR(b.amount)}` : ""} —{" "}
                {b.overdue ? (
                  <span className="font-medium text-red-600">overdue (was due {fmt(b.dueISO)})</span>
                ) : (
                  <>due {fmt(b.dueISO)}</>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">Pay it, then mark it paid to stop these reminders.</p>
        </div>
        <div className="flex flex-col gap-2 px-6 py-6">
          <Link
            href="/in-hand"
            onClick={close}
            className="w-full rounded-xl bg-amber-600 px-4 py-3 text-center text-base font-semibold text-white hover:bg-amber-700"
          >
            Go to bills →
          </Link>
          <button type="button" onClick={close} className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100">
            Dismiss for today
          </button>
        </div>
      </div>
    </div>
  );
}
