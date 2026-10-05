"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { formatINR } from "@/lib/format";
import { fundExistingBill } from "@/app/actions";

type Source = { memberId: number; name: string; spare: number };

// "Fund from held cash" for an ALREADY-SAVED short bill, opened from the Money Plan. Lists the members
// holding spare pool cash right before this bill (computed by the caller from the step's balancesBefore),
// lets the head cover the shortfall from one or several of them, and saves tagged funding (funder → payer,
// no payback) via fundExistingBill. Partial funding is fine — whatever's left stays short and the bill
// keeps its button, so a knock-on chain is cleared one step at a time.
export function FundBillModal({
  periodId, billId, label, payerName, shortfall, day, sources, onClose,
}: {
  periodId: number;
  billId: number;
  label: string;
  payerName: string;
  shortfall: number;
  day: number | null;
  sources: Source[];
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [picks, setPicks] = useState<Record<number, number>>({});

  const coveredTotal = useMemo(
    () => Math.round(Object.values(picks).reduce((a, b) => a + (b || 0), 0) * 100) / 100,
    [picks],
  );
  const remaining = Math.max(0, Math.round((shortfall - coveredTotal) * 100) / 100);

  const toggle = (memberId: number, spare: number) =>
    setPicks((p) => {
      if (p[memberId] != null) { const next = { ...p }; delete next[memberId]; return next; }
      const covered = Object.values(p).reduce((a, b) => a + (b || 0), 0);
      return { ...p, [memberId]: Math.round(Math.min(spare, Math.max(0, shortfall - covered)) * 100) / 100 }; // prefill: cover the rest, up to their spare
    });
  const setAmount = (memberId: number, spare: number, val: string) =>
    setPicks((p) => ({ ...p, [memberId]: Math.max(0, Math.min(spare, Number(val) || 0)) }));

  const submit = () => {
    const chosen = Object.entries(picks).filter(([, a]) => a > 0).map(([m, a]) => ({ memberId: Number(m), amount: a }));
    if (chosen.length === 0) return;
    start(async () => {
      const fd = new FormData();
      fd.set("periodId", String(periodId));
      fd.set("billId", String(billId));
      fd.set("funders", JSON.stringify(chosen));
      const r = await fundExistingBill(fd);
      if (r.ok) { toast("Funding added", "success"); onClose(); router.refresh(); }
      else toast(r.error ?? "Couldn't add funding", "error");
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <h3 className="text-sm font-semibold text-slate-900">Fund “{label}” from held cash</h3>
        <p className="mt-1 text-xs text-amber-700">
          ⚠ {payerName} is short {formatINR(shortfall)}{day != null ? ` on day ${day}` : ""}. Cover it from people holding spare pool cash — paid straight to {payerName}, no repayment.
        </p>
        {sources.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No one is holding spare cash before this bill, so there&apos;s nothing to fund it from yet. It clears once earlier income or funding lands.</p>
        ) : (
          <>
            <div className="mt-3 space-y-1.5">
              {sources.map((src) => {
                const on = picks[src.memberId] != null;
                return (
                  <div key={src.memberId} className={`rounded-lg border p-2 ${on ? "border-emerald-300 bg-emerald-50" : "border-slate-200"}`}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input type="checkbox" checked={on} onChange={() => toggle(src.memberId, src.spare)} className="accent-emerald-600" />
                      <span className="font-medium text-slate-700">{src.name}</span>
                      <span className="text-slate-400">— {formatINR(src.spare)} spare</span>
                    </label>
                    {on && (
                      <input
                        type="number" inputMode="numeric" min={0} max={src.spare} value={picks[src.memberId] ?? 0}
                        onChange={(e) => setAmount(src.memberId, src.spare, e.target.value)}
                        className="mt-1.5 w-full rounded-md border border-slate-200 px-2 py-1 text-sm tabular-nums"
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs font-medium text-slate-600">
              Covered {formatINR(coveredTotal)} of {formatINR(shortfall)}
              {remaining <= 0.005 ? " ✓" : ` — ${formatINR(remaining)} still short`}
            </p>
          </>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-500">Cancel</button>
          <button type="button" disabled={coveredTotal <= 0.005 || pending} onClick={submit} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
            {pending ? "Funding…" : "Add funding"}
          </button>
        </div>
      </div>
    </div>
  );
}
