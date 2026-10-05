"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { formatINR } from "@/lib/format";
import { bridgeShortBill } from "@/app/actions";

type Source = { memberId: number; name: string; spare: number };

function ordinal(day: number) {
  return `${day}${["th", "st", "nd", "rd"][((day % 100) - 20) % 10] ?? ["th", "st", "nd", "rd"][day % 100] ?? "th"}`;
}

// A REPAYABLE pool bridge for a short bill whose payer's own income lands later this month. The head picks
// who fronts the cash (one or several holders); on save it creates, per funder, a 3-step set: funder →
// debtor (above the bill), then on the payback day debtor → hub and hub → funder. Net-zero for everyone —
// pure timing. The payback day (when the debtor's income lands) is shown up front so it's a clear loan.
export function BridgeBillModal({
  periodId, billId, label, payerName, shortfall, day, paybackDay, sources, onClose,
}: {
  periodId: number;
  billId: number;
  label: string;
  payerName: string;
  shortfall: number;
  day: number | null;
  paybackDay: number | null;
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
      return { ...p, [memberId]: Math.round(Math.min(spare, Math.max(0, shortfall - covered)) * 100) / 100 };
    });
  const setAmount = (memberId: number, spare: number, val: string) =>
    setPicks((p) => ({ ...p, [memberId]: Math.max(0, Math.min(spare, Number(val) || 0)) }));

  const canSave = coveredTotal > 0.005 && paybackDay != null && !pending;

  const submit = () => {
    const chosen = Object.entries(picks).filter(([, a]) => a > 0).map(([m, a]) => ({ memberId: Number(m), amount: a }));
    if (chosen.length === 0 || paybackDay == null) return;
    start(async () => {
      const fd = new FormData();
      fd.set("periodId", String(periodId));
      fd.set("billId", String(billId));
      fd.set("paybackDay", String(paybackDay));
      fd.set("funders", JSON.stringify(chosen));
      const r = await bridgeShortBill(fd);
      if (r.ok) { toast("Bridge added", "success"); onClose(); router.refresh(); }
      else toast(r.error ?? "Couldn't add the bridge", "error");
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <h3 className="text-sm font-semibold text-slate-900">Bridge “{label}” until {payerName}&apos;s income lands</h3>
        <p className="mt-1 text-xs text-amber-700">
          ⚠ {payerName} is short {formatINR(shortfall)}{day != null ? ` on day ${day}` : ""} — their own income lands later. Someone fronts it now; the pool pays them back.
        </p>
        {paybackDay != null ? (
          <p className="mt-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
            ↩ Repaid by the pool on the {ordinal(paybackDay)} (when {payerName}&apos;s income lands). {payerName} returns it to the pool that day, then the pool repays the funder.
          </p>
        ) : (
          <p className="mt-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-600">
            {payerName} has no later income this month to repay from — a bridge can&apos;t be squared up, so use plain funding instead.
          </p>
        )}
        {sources.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No one (other than the hub) is holding spare cash before this bill, so there&apos;s no one to front it.</p>
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
          <button type="button" disabled={!canSave} onClick={submit} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
            {pending ? "Bridging…" : "Add bridge"}
          </button>
        </div>
      </div>
    </div>
  );
}
