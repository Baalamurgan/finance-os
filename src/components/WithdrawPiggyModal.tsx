"use client";

import { useEffect, useState } from "react";
import { withdrawPiggy } from "@/app/actions";
import { formatINR } from "@/lib/format";

type Cat = { id: number; name: string; sinking?: boolean };

export function WithdrawPiggyModal({
  periodId,
  periodLabel,
  categories,
  available,
}: {
  periodId: number;
  periodLabel: string;
  categories: Cat[];
  available: { general: number; sinking: Record<number, number> };
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("general");
  const sinkingFunds = categories.filter((c) => c.sinking);

  const currentAvail = source === "general" ? available.general : available.sinking[Number(source)] ?? 0;
  const amountNum = Number(amount) || 0;
  const overdraw = amountNum > currentAvail;

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
                if (overdraw) {
                  e.preventDefault();
                  alert(`Only ${formatINR(currentAvail)} is available here. Enter a smaller amount.`);
                  return;
                }
                if (!confirm(`Use ${formatINR(amountNum)} from ${source === "general" ? "General Piggy" : "the sinking fund"}?`)) {
                  e.preventDefault();
                  return;
                }
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
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    autoFocus
                    required
                    placeholder="0"
                    className={`mt-1 w-full rounded-lg border px-3 py-3 text-3xl font-bold tabular-nums outline-none focus:ring-2 ${
                      overdraw
                        ? "border-red-400 focus:border-red-400 focus:ring-red-100"
                        : "border-slate-300 focus:border-indigo-400 focus:ring-indigo-100"
                    }`}
                  />
                  <p className={`mt-1 text-xs ${overdraw ? "font-medium text-red-600" : "text-slate-400"}`}>
                    {overdraw ? "More than available — " : "Available: "}
                    {formatINR(currentAvail)}
                  </p>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500">Take from</label>
                  <select
                    name="source"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="input mt-1 w-full"
                  >
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
                <button type="submit" disabled={overdraw || amountNum <= 0} className="btn disabled:opacity-40">
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
