"use client";

import { useEffect, useState } from "react";
import { withdrawPiggy } from "@/app/actions";

type Cat = { id: number; name: string; sinking?: boolean };

export function WithdrawPiggyModal({
  periodId,
  periodLabel,
  categories,
}: {
  periodId: number;
  periodLabel: string;
  categories: Cat[];
}) {
  const [open, setOpen] = useState(false);
  const sinkingFunds = categories.filter((c) => c.sinking);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn">
        Use Piggy
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="my-auto flex max-h-[88vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-lg font-bold text-slate-900">Use Piggy money</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form
              action={withdrawPiggy}
              onSubmit={(e) => {
                if (!e.currentTarget.checkValidity()) return;
                setOpen(false);
              }}
              className="flex min-h-0 flex-col"
            >
              <div className="space-y-4 overflow-y-auto px-5 py-4">
                <input type="hidden" name="periodId" value={periodId} />

                <div>
                  <label className="text-xs font-medium text-slate-500">Amount (₹)</label>
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="1"
                    autoFocus
                    required
                    placeholder="0"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-3xl font-bold tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500">Take from</label>
                  <select name="source" defaultValue="general" className="input mt-1 w-full">
                    <option value="general">General Piggy</option>
                    {sinkingFunds.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} (sinking fund)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500">
                    Record the use under
                  </label>
                  <select name="expenseCategoryId" required className="input mt-1 w-full">
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500">Note</label>
                  <input
                    name="note"
                    placeholder="e.g. Sent to Dad, BOB loan, Chit"
                    className="input mt-1 w-full"
                  />
                </div>

                <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                  This adds the amount as income to <b>{periodLabel}</b> and a matching expense, and
                  reduces the chosen Piggy/fund.
                </p>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button type="submit" className="btn">
                  Use Piggy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
