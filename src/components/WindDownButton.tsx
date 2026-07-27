"use client";

import { useEffect, useState } from "react";
import { windDownMonth } from "@/app/actions";
import { formatINR } from "@/lib/format";

// Wind down & lock a month. When there are under-budget leftovers heading to Piggy, a
// confirmation modal lets the head choose to instead bring them into next month's income.
export function WindDownButton({
  periodId,
  label,
  leftovers,
  nextLabel,
}: {
  periodId: number;
  label: string;
  leftovers: number; // this month's under-budget leftovers (the general-Piggy contribution)
  nextLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [toIncome, setToIncome] = useState(false); // false = keep in Piggy (default)

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const hasLeftovers = leftovers > 0;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn w-full">
        Wind down &amp; lock {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md rounded-t-3xl bg-white shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">Wind down {label}?</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md px-2 text-2xl leading-none text-slate-400 hover:bg-slate-100">✕</button>
            </div>

            <form action={windDownMonth} className="space-y-4 px-5 py-5">
              <input type="hidden" name="periodId" value={periodId} />
              <input type="hidden" name="leftoversToIncome" value={toIncome ? "1" : "0"} />

              <p className="text-sm leading-relaxed text-slate-600">
                Over-budget amounts and misc spends carry into {nextLabel} as expenses, the balance
                carries forward, and {label} is <b>locked</b>. This can&apos;t be undone.
              </p>

              {hasLeftovers && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-medium text-slate-500">
                    Under-budget leftovers this month: <b className="text-slate-800">{formatINR(leftovers)}</b>
                  </div>
                  <div className="mt-2 space-y-2">
                    <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${!toIncome ? "border-indigo-400 bg-white" : "border-slate-200"}`}>
                      <input type="radio" name="choice" checked={!toIncome} onChange={() => setToIncome(false)} className="mt-0.5" />
                      <span className="text-sm">
                        <span className="font-medium text-slate-800">🐷 Keep in Piggy</span>
                        <span className="block text-xs text-slate-500">Set the leftovers aside in the Piggy bank (default).</span>
                      </span>
                    </label>
                    <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${toIncome ? "border-indigo-400 bg-white" : "border-slate-200"}`}>
                      <input type="radio" name="choice" checked={toIncome} onChange={() => setToIncome(true)} className="mt-0.5" />
                      <span className="text-sm">
                        <span className="font-medium text-slate-800">➕ Add to {nextLabel} income</span>
                        <span className="block text-xs text-slate-500">Bring the {formatINR(leftovers)} into next month as spendable income instead of Piggy.</span>
                      </span>
                    </label>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button type="button" onClick={() => setOpen(false)} className="min-h-12 flex-1 rounded-xl border-2 border-slate-200 px-4 py-3 text-base font-medium text-slate-600">Cancel</button>
                <button type="submit" className="min-h-12 flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-base font-semibold text-white hover:bg-indigo-700">
                  Wind down &amp; lock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
