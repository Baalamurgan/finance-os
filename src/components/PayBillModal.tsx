"use client";

import { useActionState, useEffect, useState } from "react";
import { payPeriodicBill, type PayBillState } from "@/app/actions";
import { formatINR } from "@/lib/format";
import { useToast } from "@/components/Toast";

const INIT: PayBillState = { ok: false, n: 0 };

// Pay a due-month "save the share" bill. The bill's own fund is used first & fully; if it's
// short, the user picks where the remainder comes from — general Piggy or out-of-pocket.
export function PayBillModal({
  categoryId,
  periodId,
  name,
  bill,
  fund,
  generalPiggy,
  spendPeriodId,
  carriedFrom,
}: {
  categoryId: number;
  periodId: number;
  name: string;
  bill: number;
  fund: number;
  generalPiggy: number;
  // For a CARRIED (late) payment: `periodId` is the closed month owed; `spendPeriodId` is the
  // current open month the money moves in. `carriedFrom` is that closed month's label.
  spendPeriodId?: number;
  carriedFrom?: string;
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  // All four "pay" forms submit the same action; one useActionState drives them so we can toast
  // the result (a blocked action used to just close the modal and look like it did nothing).
  const [state, formAction] = useActionState(payPeriodicBill, INIT);
  // The ACTUAL amount to pay — bills like EB/WiFi vary month to month; defaults to the
  // configured amount. Whatever the fund doesn't need is simply left in the fund.
  const [amountStr, setAmountStr] = useState(String(bill));
  useEffect(() => {
    if (!open) return;
    setAmountStr(String(bill));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, bill]);

  // React to the action result: success → toast + close; blocked → toast the reason, keep open.
  useEffect(() => {
    if (state.n === 0) return;
    if (state.ok) { toast(`${name} marked paid`, "success"); setOpen(false); }
    else if (state.error) toast(state.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  const actual = Math.max(0, Math.round((Number(amountStr) || 0) * 100) / 100);
  const fromFund = Math.min(fund, actual);
  const remaining = Math.round((actual - fromFund) * 100) / 100;
  const leftover = Math.round((fund - fromFund) * 100) / 100; // stays in the fund
  const fundCovers = remaining <= 0;

  const hidden = (source: string) => (
    <>
      <input type="hidden" name="categoryId" value={categoryId} />
      <input type="hidden" name="periodId" value={periodId} />
      {spendPeriodId != null && <input type="hidden" name="spendPeriodId" value={spendPeriodId} />}
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="amount" value={actual} />
    </>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Pay this bill"
        className="rounded-full border border-teal-200 px-2 py-0.5 text-[10px] font-medium text-teal-600 hover:border-teal-400 hover:bg-teal-50"
      >
        pay
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-t-3xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-bold text-slate-900">Pay {name}{carriedFrom ? <span className="ml-1 text-xs font-medium text-rose-500">· overdue from {carriedFrom}</span> : null}</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md px-2 text-2xl leading-none text-slate-400 hover:bg-slate-100">✕</button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-500">
                  Actual amount to pay
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base font-semibold tabular-nums text-slate-800 focus:border-teal-400 focus:outline-none"
                  />
                  <span className="mt-0.5 block text-[10px] font-normal text-slate-400">
                    Configured bill {formatINR(bill)} — edit to the real amount this month.
                  </span>
                </label>
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Fund available</span><span className="tabular-nums text-slate-600">{formatINR(fund)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">From its fund</span><span className="tabular-nums text-teal-700">− {formatINR(fromFund)}</span></div>
                  {fundCovers && leftover > 0 && (
                    <div className="flex justify-between"><span className="text-slate-500">Stays in the fund</span><span className="tabular-nums text-slate-500">{formatINR(leftover)}</span></div>
                  )}
                  {!fundCovers && (
                    <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-medium"><span className="text-slate-600">Remaining</span><span className="tabular-nums text-red-600">{formatINR(remaining)}</span></div>
                  )}
                </div>
              </div>

              {fundCovers ? (
                <div className="space-y-3">
                  <form action={formAction} className="space-y-3">
                    {hidden("fund")}
                    <p className="text-xs text-slate-500">The fund fully covers this bill.</p>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => setOpen(false)} className="min-h-11 flex-1 rounded-xl border-2 border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600">Cancel</button>
                      <button type="submit" disabled={actual <= 0} className="min-h-11 flex-1 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Pay {formatINR(actual)} from fund</button>
                    </div>
                  </form>
                  <AlreadyPaidButton hidden={hidden} formAction={formAction} />
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">
                    The fund is short by {formatINR(remaining)}. Take the rest from the Piggy bank
                    ({formatINR(generalPiggy)} available) or out-of-pocket (logged as the payer&apos;s misc).
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    <form action={formAction}>
                      {hidden("piggy")}
                      <button type="submit" className="min-h-11 w-full rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600">
                        Remaining from Piggy{generalPiggy < remaining ? ` (₹${Math.round(generalPiggy).toLocaleString("en-IN")} + rest out-of-pocket)` : ""}
                      </button>
                    </form>
                    <form action={formAction}>
                      {hidden("pocket")}
                      <button type="submit" className="min-h-11 w-full rounded-xl bg-slate-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
                        Remaining out-of-pocket
                      </button>
                    </form>
                    <AlreadyPaidButton hidden={hidden} formAction={formAction} />
                    <button type="button" onClick={() => setOpen(false)} className="min-h-11 w-full rounded-xl border-2 border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600">Discard</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// "Already paid outside the app" — records the bill as paid with no money movement
// (fund/Piggy untouched, no misc spend). Reversible via Undo in the paid list.
function AlreadyPaidButton({
  hidden,
  formAction,
}: {
  hidden: (source: string) => React.ReactNode;
  formAction: (formData: FormData) => void;
}) {
  return (
    <form action={formAction}>
      {hidden("already")}
      <button
        type="submit"
        title="It was already paid outside the app — just record it, don't move any money"
        className="min-h-11 w-full rounded-xl border-2 border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50"
      >
        Mark as already paid
        <span className="ml-1 text-[11px] text-slate-400">· no money moves</span>
      </button>
    </form>
  );
}
