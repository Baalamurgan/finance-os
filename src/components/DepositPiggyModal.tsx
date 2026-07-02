"use client";

import { useEffect, useState } from "react";
import { depositPiggy } from "@/app/actions";
import { formatINR } from "@/lib/format";

type Fund = { id: number; name: string };

// Head-only: add money into the general Piggy or a specific sinking fund.
export function DepositPiggyModal({ sinkingFunds }: { sinkingFunds: Fund[] }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [target, setTarget] = useState("general");
  const amountNum = Number(amount) || 0;
  const targetName =
    target === "general" ? "General Piggy" : sinkingFunds.find((f) => String(f.id) === target)?.name ?? "fund";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50">
        + Add money
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/40 sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-white shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">Add money to Piggy</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md px-2 text-2xl leading-none text-slate-400 hover:bg-slate-100">
                ✕
              </button>
            </div>

            <form
              action={depositPiggy}
              onSubmit={(e) => {
                if (!e.currentTarget.checkValidity()) return;
                if (!confirm(`Add ${formatINR(amountNum)} to ${targetName}?`)) {
                  e.preventDefault();
                  return;
                }
                setOpen(false);
                setAmount("");
              }}
              className="space-y-4 px-5 py-5"
            >
              <div>
                <label className="text-sm font-medium text-slate-600">Amount (₹)</label>
                <input
                  name="amount"
                  type="number"
                  step="1"
                  min="1"
                  inputMode="numeric"
                  autoFocus
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="mt-1.5 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-3xl font-bold tabular-nums outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600">Add to</label>
                <select
                  name="target"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="input mt-1.5 w-full"
                >
                  <option value="general">General Piggy</option>
                  {sinkingFunds.map((f) => (
                    <option key={f.id} value={f.id}>{f.name} (sinking fund)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600">Note</label>
                <input name="note" placeholder="e.g. Diwali bonus, returned advance" className="input mt-1.5 w-full" />
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button type="button" onClick={() => setOpen(false)} className="min-h-12 flex-1 rounded-xl border-2 border-slate-200 px-4 py-3 text-base font-medium text-slate-600">
                  Cancel
                </button>
                <button type="submit" disabled={amountNum <= 0} className="min-h-12 flex-1 rounded-xl bg-amber-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-40">
                  Add money
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
