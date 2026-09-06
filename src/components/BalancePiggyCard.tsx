"use client";

import { useState } from "react";
import { formatINR } from "@/lib/format";

// Balance + Piggy summary. On a PREVIEW/provisional month the Piggy is still an ESTIMATE and isn't part
// of the month's real spendable balance yet, so it's EXCLUDED from the headline total by default — with
// a switch to fold it in — and the total is labelled so members can see at a glance that the balance
// doesn't include Piggy. Open months keep the plain "Balance + Piggy" sum (the Piggy is real cash).
export function BalancePiggyCard({
  balance,
  piggy,
  isPreview,
  pendingLump,
}: {
  balance: number;
  piggy: number;
  isPreview: boolean;
  pendingLump: number;
}) {
  const [includePiggy, setIncludePiggy] = useState(!isPreview);
  const showSum = !isPreview || includePiggy;
  const total = balance + (showSum ? piggy : 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Balance (Income − Expense)</div>
          <div className="text-lg font-bold text-indigo-700">{formatINR(balance)}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">🐷 Piggy bank{isPreview ? " (est.)" : ""}</div>
          <div className="text-lg font-bold text-slate-800">{formatINR(piggy)}</div>
        </div>
      </div>

      {isPreview && (
        <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={includePiggy}
            onChange={(e) => setIncludePiggy(e.target.checked)}
            className="h-4 w-4 accent-indigo-600"
          />
          Add the estimated Piggy to the total
          <span className="font-normal text-slate-400">(off = this month&apos;s balance only)</span>
        </label>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-dashed border-slate-200 pt-3">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {showSum ? "Balance + Piggy" : "Balance — Piggy not included"}
        </span>
        <span className="text-lg font-bold tabular-nums text-slate-900">{formatINR(total)}</span>
      </div>

      {isPreview && !includePiggy && piggy > 0.005 && (
        <p className="mt-1 text-[11px] text-slate-400">
          🐷 {formatINR(piggy)} estimated Piggy is kept separate — toggle above to include it.
        </p>
      )}
      {pendingLump > 0.005 && (
        <div className="mt-2 text-[11px] text-amber-700">
          🐷 {formatINR(pendingLump)} of the Piggy is last month&apos;s leftover still with the category owners — not yet handed to the holder.
        </div>
      )}
    </div>
  );
}
