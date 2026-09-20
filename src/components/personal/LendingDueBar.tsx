"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getMyLendingReminders, type LendingReminder } from "@/app/personal/actions";
import { formatINR } from "@/lib/format";

// Persistent top bar for repay-by dates on OPEN lending/borrowing. Unlike the dismissible card/step
// banners, this one is NOT dismissible — it stays from `due − notifyDaysBefore` (or overdue) until the
// debt is marked paid/received or deleted, since it re-derives from live loans on every load. Shows
// BOTH sides: money you owe (repay) and money owed to you (collect). Amber for upcoming, red if any
// item is overdue. Fetches its own data so the nav stays a pure client component.
export function LendingDueBar() {
  const [items, setItems] = useState<LendingReminder[] | null>(null);

  useEffect(() => {
    let alive = true;
    getMyLendingReminders().then((r) => { if (alive) setItems(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!items || items.length === 0) return null;

  const anyOverdue = items.some((i) => i.overdue);
  const n = items.length;
  const label = (i: LendingReminder) =>
    i.direction === "borrowed" ? `Repay ${i.counterparty} ${formatINR(i.amount)}` : `Collect ${formatINR(i.amount)} from ${i.counterparty}`;
  const preview = items.slice(0, 2).map(label).join(" · ");

  const tone = anyOverdue
    ? "border-red-200 bg-red-50 text-red-800"
    : "border-amber-200 bg-amber-50 text-amber-900";
  const cta = anyOverdue
    ? "border-red-300 text-red-700 hover:bg-red-100"
    : "border-amber-300 text-amber-800 hover:bg-amber-100";

  return (
    <div className={`border-b px-4 py-2 text-sm ${tone}`}>
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        <span className="shrink-0">🤝</span>
        <div className="min-w-0 flex-1">
          <b>{n} repayment{n > 1 ? "s" : ""} {anyOverdue ? "need action" : "coming up"}</b>
          <span className="opacity-80"> · {preview}{n > 2 ? `, +${n - 2} more` : ""}</span>
        </div>
        <Link href="/personal/loans" className={`shrink-0 rounded-md border bg-white px-2.5 py-1 text-xs font-medium ${cta}`}>
          Lending →
        </Link>
      </div>
    </div>
  );
}
