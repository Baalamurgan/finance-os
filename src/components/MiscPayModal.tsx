"use client";

import { useActionState, useEffect, useState } from "react";
import { payMiscBill, type MiscPayState } from "@/app/actions";
import { formatINR } from "@/lib/format";
import { useToast } from "@/components/Toast";

const INIT: MiscPayState = { ok: false, n: 0 };

// Pay a PLANNED MISC bill (an estimate). Enter the ACTUAL amount; the difference reconciles against the
// general Piggy: under-spent → surplus INTO the Piggy; over-spent → extra FROM the Piggy, and whatever
// the Piggy can't cover is logged as an out-of-pocket Misc Spend on the payer (confirmed here first).
export function MiscPayModal({
  id,
  name,
  estimate,
  generalPiggy,
}: {
  id: number;
  name: string;
  estimate: number;
  generalPiggy: number;
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const [state, formAction] = useActionState(payMiscBill, INIT);
  const [amountStr, setAmountStr] = useState(String(estimate));

  useEffect(() => {
    if (!open) return;
    setAmountStr(String(estimate));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, estimate]);

  useEffect(() => {
    if (state.n === 0) return;
    if (state.ok) { toast(`${name} paid`, "success"); setOpen(false); }
    else if (state.error) toast(state.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  const round = (x: number) => Math.round(x * 100) / 100;
  const actual = Math.max(0, round(Number(amountStr) || 0));
  const diff = round(actual - estimate);
  const toPiggy = diff < -0.005 ? round(-diff) : 0; // under-spent → into Piggy
  const extra = diff > 0.005 ? diff : 0; // over-spent
  const fromPiggy = extra > 0 ? round(Math.min(extra, Math.max(0, generalPiggy))) : 0;
  const outOfPocket = extra > 0 ? round(extra - fromPiggy) : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Enter what was actually paid"
        className="rounded-full border border-teal-200 px-2 py-0.5 text-[10px] font-medium text-teal-600 hover:border-teal-400 hover:bg-teal-50"
      >
        pay
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-t-3xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-bold text-slate-900">Pay {name}</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md px-2 text-2xl leading-none text-slate-400 hover:bg-slate-100">✕</button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <label className="block text-xs font-medium text-slate-500">
                Actual amount paid
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  autoFocus
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-lg font-semibold tabular-nums text-slate-800 focus:border-teal-400 focus:outline-none"
                />
                <span className="mt-0.5 block text-[10px] font-normal text-slate-400">
                  Estimated {formatINR(estimate)} — enter what was really spent.
                </span>
              </label>

              {/* Live reconciliation preview */}
              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                {toPiggy > 0 ? (
                  <div className="flex justify-between"><span className="text-slate-500">Under-spent → into Piggy</span><span className="tabular-nums text-emerald-700">+ {formatINR(toPiggy)}</span></div>
                ) : extra > 0 ? (
                  <>
                    <div className="flex justify-between"><span className="text-slate-500">Over-spent by</span><span className="tabular-nums text-red-600">{formatINR(extra)}</span></div>
                    {fromPiggy > 0 && <div className="flex justify-between"><span className="text-slate-500">From Piggy ({formatINR(generalPiggy)} avail)</span><span className="tabular-nums text-amber-700">− {formatINR(fromPiggy)}</span></div>}
                    {outOfPocket > 0 && <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-medium"><span className="text-slate-600">Out-of-pocket → misc spend</span><span className="tabular-nums text-red-600">{formatINR(outOfPocket)}</span></div>}
                  </>
                ) : (
                  <div className="text-center text-xs text-slate-400">Exactly as estimated — nothing to reconcile.</div>
                )}
              </div>

              {outOfPocket > 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                  The Piggy can&apos;t cover the overspend — <b>{formatINR(outOfPocket)}</b> will be logged as an out-of-pocket misc spend on the payer (repaid to them next month).
                </p>
              )}

              <form action={formAction} className="flex items-center gap-3">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="amount" value={actual} />
                <button type="button" onClick={() => setOpen(false)} className="min-h-11 flex-1 rounded-xl border-2 border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600">Cancel</button>
                <button type="submit" disabled={actual <= 0} className="min-h-11 flex-1 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                  {outOfPocket > 0 ? `Confirm · pay ${formatINR(actual)}` : `Pay ${formatINR(actual)}`}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
