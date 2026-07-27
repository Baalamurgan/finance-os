"use client";

import { useEffect, useState } from "react";
import { formatINR } from "@/lib/format";
import { markCardBillPaid } from "@/app/personal/actions";

// "Mark bill paid" with the EXACT amount you actually paid (defaults to the cycle total,
// but you can edit it — e.g. you paid the full statement, a partial amount, or it differs
// from the in-app tag total). The entered amount is the real cash that leaves this month.
export function MarkBillPaidButton({
  cardId,
  cardName,
  cycleEndISO,
  cycleTotal,
}: {
  cardId: number;
  cardName: string;
  cycleEndISO: string;
  cycleTotal: number;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(Math.round(cycleTotal)));
  const amountNum = Number(amount) || 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => { setAmount(String(Math.round(cycleTotal))); setOpen(true); }}
        className="whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white active:bg-emerald-700"
      >
        Mark bill paid
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md rounded-t-3xl bg-white shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">Pay {cardName} bill</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md px-2 text-2xl leading-none text-slate-400 hover:bg-slate-100">✕</button>
            </div>
            <form action={markCardBillPaid} onSubmit={() => setTimeout(() => setOpen(false), 0)} className="space-y-4 px-5 py-5">
              <input type="hidden" name="cardAccountId" value={cardId} />
              <input type="hidden" name="cycleEnd" value={cycleEndISO} />
              <input type="hidden" name="cycleTotal" value={cycleTotal} />
              <div>
                <label className="text-sm font-medium text-slate-600">Amount paid (₹)</label>
                <input
                  name="amount" type="number" step="0.01" min="0.01" inputMode="numeric" autoFocus required
                  value={amount} onChange={(e) => setAmount(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-3xl font-bold tabular-nums outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Tagged total for this cycle: {formatINR(cycleTotal)}. Edit to match what you actually paid — this exact amount leaves your cash this month.
                </p>
                {amountNum > 0 && amountNum < cycleTotal && (
                  <p className="mt-1 text-[11px] font-medium text-emerald-700">
                    {formatINR(cycleTotal - amountNum)} saved → recorded as cashback on this card.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button type="button" onClick={() => setOpen(false)} className="min-h-12 flex-1 rounded-xl border-2 border-slate-200 px-4 py-3 text-base font-medium text-slate-600">Cancel</button>
                <button type="submit" disabled={amountNum <= 0 || Number.isNaN(amountNum)} className="min-h-12 flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-40">
                  Mark paid
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
