"use client";

import { useState } from "react";
import { payPlannedSpend } from "@/app/personal/actions";
import { formatINR } from "@/lib/format";

export type PlannedSpend = { id: number; label: string; icon: string | null; category: string; amount: number; day: number; payId: number | null; payName: string | null };
type Acct = { id: number; name: string; type: string };

const GROUPS: { label: string; types: string[] }[] = [
  { label: "Bank / UPI", types: ["bank"] },
  { label: "Cash", types: ["cash"] },
  { label: "Debit & prepaid cards", types: ["debit_card", "prepaid_card"] },
  { label: "Credit cards — settles at the bill", types: ["credit_card"] },
];

// This month's recurring spends from Setup, waiting to be paid. Marking one paid turns it into a normal spend
// (so it lowers Can-spend), from the Cash/UPI or card you pick. It is the same entry as the Money-Plan step.
export function PlannedSpends({ items, accounts }: { items: PlannedSpend[]; accounts: Acct[] }) {
  const [asking, setAsking] = useState<PlannedSpend | null>(null);
  if (items.length === 0) return null;
  const total = items.reduce((t, i) => t + i.amount, 0);
  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50/40 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Planned this month</h2>
        <span className="text-xs text-slate-500">{items.length} recurring spend{items.length > 1 ? "s" : ""} · {formatINR(total)}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500">Copied from your Setup. Mark one paid and it becomes a spend — it comes out of Can-spend.</p>
      <ul className="mt-2 divide-y divide-sky-100">
        {items.map((it) => (
          <li key={it.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate text-slate-800">{it.icon} {it.label}</span>
              <span className="block truncate text-[11px] text-slate-400">day {it.day} · {it.category} · {it.payName ? `from ${it.payName}` : "pick Cash/UPI or card when paying"}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="tabular-nums font-medium text-slate-800">{formatINR(it.amount)}</span>
              {it.payId != null ? (
                <form action={payPlannedSpend}>
                  <input type="hidden" name="spendId" value={it.id} />
                  <button className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Mark paid</button>
                </form>
              ) : (
                <button type="button" onClick={() => setAsking(it)} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Mark paid</button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {asking && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setAsking(null)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h3 className="text-lg font-bold text-slate-900">Paid: {asking.label}</h3>
              <button type="button" onClick={() => setAsking(null)} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
            </div>
            <form action={payPlannedSpend} onSubmit={() => setTimeout(() => setAsking(null), 0)} className="space-y-4 px-5 py-4">
              <input type="hidden" name="spendId" value={asking.id} />
              <input type="hidden" name="method" value="other" />
              <p className="text-sm text-slate-500">{formatINR(asking.amount)} — how did you pay? A bank or cash account is debited; a card goes on its bill.</p>
              <select name="fromAccountId" defaultValue="" className="input w-full">
                <option value="">Cash / UPI (no account)</option>
                {GROUPS.map((g) => {
                  const list = accounts.filter((a) => g.types.includes(a.type));
                  return list.length === 0 ? null : (
                    <optgroup key={g.label} label={g.label}>{list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
                  );
                })}
              </select>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button type="button" onClick={() => setAsking(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600">Cancel</button>
                <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Mark paid</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
