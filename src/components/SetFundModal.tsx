"use client";

import { useEffect, useState } from "react";
import { setFundBalance } from "@/app/actions";
import { formatINR } from "@/lib/format";

// Head-only: correct a fund's CURRENT balance to an exact amount (records an
// "Adjustment" entry). target = "general" | sinking categoryId (as string).
export function SetFundModal({ target, name, current }: { target: string; name: string; current: number }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(Math.round(current)));

  useEffect(() => {
    if (!open) return;
    setAmount(String(Math.round(current)));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, current]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        Edit
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-t-3xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-bold text-slate-900">Set {name} balance</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md px-2 text-2xl leading-none text-slate-400 hover:bg-slate-100">✕</button>
            </div>
            <form
              action={setFundBalance}
              onSubmit={(e) => {
                if (!e.currentTarget.checkValidity()) return;
                if (!confirm(`Set ${name} to ${formatINR(Number(amount) || 0)}? (currently ${formatINR(current)})`)) {
                  e.preventDefault();
                  return;
                }
                setOpen(false);
              }}
              className="space-y-4 px-5 py-5"
            >
              <input type="hidden" name="target" value={target} />
              <div>
                <label className="text-sm font-medium text-slate-600">Correct balance (₹)</label>
                <input
                  name="amount"
                  type="number"
                  step="1"
                  inputMode="numeric"
                  autoFocus
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-3xl font-bold tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
                <p className="mt-1 text-xs text-slate-400">Currently {formatINR(current)} — the difference is logged as an adjustment.</p>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setOpen(false)} className="min-h-11 flex-1 rounded-xl border-2 border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600">Cancel</button>
                <button type="submit" className="min-h-11 flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">Set balance</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
