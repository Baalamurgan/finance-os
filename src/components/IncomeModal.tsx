"use client";

import { useEffect, useState } from "react";
import { addIncome } from "@/app/actions";

type Mem = { id: number; name: string };

// Add-income modal — matches the Sheet "+ Add expense" UI (sheet trigger + Repeat toggle).
export function IncomeModal({ members, periodId }: { members: Mem[]; periodId: number }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-green-300 px-3 py-2 text-left text-sm font-medium text-green-700 hover:bg-green-50"
      >
        + Add income
        <span className="block text-[11px] font-normal text-slate-400">
          salary / rent / one-off — adds to the balance
        </span>
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
              <h2 className="text-lg font-bold text-slate-900">Add income</h2>
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
              action={addIncome}
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
                    inputMode="decimal"
                    autoFocus
                    required
                    placeholder="0"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-3xl font-bold tabular-nums outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500">Source</label>
                  <input name="source" required placeholder="e.g. Bala salary, G704 rent" className="input mt-1 w-full" />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500">Owner</label>
                  <select name="ownerId" className="input mt-1 w-full" defaultValue="">
                    <option value="">Shared</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>

                <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <input type="checkbox" name="repeat" defaultChecked className="h-4 w-4 accent-green-600" />
                  Repeat every month
                  <span className="text-xs text-slate-400">(uncheck = only this month)</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button type="submit" className="btn">Add income</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
