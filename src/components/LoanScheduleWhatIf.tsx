"use client";

import { useMemo, useState, useTransition } from "react";
import { amortize, round2, type EmiOverride } from "@/lib/loan/amortize";
import { formatINR } from "@/lib/format";
import { useToast } from "@/components/Toast";
import { saveLoanPlan } from "@/app/actions";

// Interactive repayment-schedule what-if. Shows the CURRENT projection (from the loan's live outstanding)
// next to an editable PLANNED projection: change the EMI paid in any month, hit Recalculate (with a brief
// shimmer), and see the whole schedule + savings recompute. Revert goes back to the original. Pure client
// math via the amortization engine — nothing is saved; it's a sandbox for "what if I paid differently".

type Props = {
  loanId: number;
  canEdit: boolean;
  outstanding: number;
  annualRatePct: number;
  emi: number;
  startISO: string | null;
  startIndex: number;
  savedOverrides: EmiOverride[];
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) : "—");
const keyOf = (ov: EmiOverride[]) => JSON.stringify([...ov].sort((a, b) => a.monthIndex - b.monthIndex));

export function LoanScheduleWhatIf({ loanId, canEdit, outstanding, annualRatePct, emi, startISO, startIndex, savedOverrides }: Props) {
  const toast = useToast();
  const [savingPending, startSaving] = useTransition();
  const base = useMemo(
    () => amortize({ principal: outstanding, annualRatePct, emi, startDate: startISO, startIndex }),
    [outstanding, annualRatePct, emi, startISO, startIndex],
  );

  const [drafts, setDrafts] = useState<Record<number, string>>({}); // monthIndex → typed EMI (uncommitted)
  const [committed, setCommitted] = useState<EmiOverride[]>(savedOverrides); // applied overrides (seeded from the saved plan)
  const [loading, setLoading] = useState(false);

  const planned = useMemo(
    () => (committed.length ? amortize({ principal: outstanding, annualRatePct, emi, startDate: startISO, startIndex, emiOverrides: committed }) : base),
    [committed, base, outstanding, annualRatePct, emi, startISO, startIndex],
  );

  // Effective overrides = committed with any typed drafts layered on top.
  const collect = (): EmiOverride[] => {
    const map = new Map<number, number>();
    for (const o of committed) map.set(o.monthIndex, o.emi);
    for (const [k, v] of Object.entries(drafts)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) map.set(Number(k), n);
    }
    return [...map.entries()].map(([monthIndex, emi]) => ({ monthIndex, emi }));
  };

  const dirty = Object.keys(drafts).length > 0 || committed.length > 0;
  const unsaved = keyOf(collect()) !== keyOf(savedOverrides);
  const interestSaved = round2(base.totalInterest - planned.totalInterest);
  const monthsSaved = base.months - planned.months;

  const recalc = () => {
    const overrides = collect();
    setLoading(true);
    // A deliberate beat so the shimmer reads as "recalculating", then swap in the new schedule.
    setTimeout(() => {
      setCommitted(overrides);
      setDrafts({});
      setLoading(false);
    }, 650);
  };
  const revert = () => {
    setDrafts({});
    setCommitted([]);
  };
  const savePlan = () => {
    const overrides = collect();
    setCommitted(overrides);
    setDrafts({});
    startSaving(async () => {
      const res = await saveLoanPlan(loanId, overrides);
      toast(res.ok ? (overrides.length ? "Plan saved" : "Plan cleared") : "Couldn't save the plan", res.ok ? "success" : "error");
    });
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Repayment schedule <span className="text-xs font-normal text-slate-400">· what-if</span>
          {canEdit && (unsaved ? <span className="ml-1.5 text-[11px] font-normal text-amber-600">· unsaved</span> : savedOverrides.length > 0 ? <span className="ml-1.5 text-[11px] font-normal text-emerald-600">· plan saved</span> : null)}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={revert}
            disabled={!dirty || loading || savingPending}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-40"
          >
            ↺ Revert
          </button>
          <button
            type="button"
            onClick={recalc}
            disabled={loading || savingPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-white" /> : "↻"} Recalculate
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={savePlan}
              disabled={savingPending || loading || !unsaved}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {savingPending ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-emerald-300 border-t-white" /> : "💾"} Save plan
            </button>
          )}
        </div>
      </div>

      {/* savings banner (planned vs current) */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Current interest left" value={formatINR(base.totalInterest)} />
        <Metric label="Planned interest left" value={formatINR(planned.totalInterest)} accent={committed.length > 0} />
        <Metric label="Interest saved" value={`${interestSaved >= 0 ? "" : "+"}${formatINR(Math.abs(interestSaved))}`} good={interestSaved > 0} bad={interestSaved < 0} />
        <Metric label="Months saved" value={`${monthsSaved >= 0 ? "" : "+"}${Math.abs(monthsSaved)} mo`} good={monthsSaved > 0} bad={monthsSaved < 0} />
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        Edit the EMI for any month in the <b>Planned</b> table, then Recalculate. Pay more → finish sooner &amp; save interest; pay less → the opposite. Planning estimate; nothing is saved.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* CURRENT (read-only) */}
        <div>
          <div className="mb-1.5 text-xs font-semibold text-slate-600">Current <span className="font-normal text-slate-400">· {base.months} payments · closes {fmtDate(base.closureDate)}</span></div>
          <div className="max-h-96 overflow-auto rounded-lg border border-slate-100">
            <table className="w-full min-w-[320px] text-right text-xs tabular-nums">
              <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-2 py-1.5 text-left">Month</th><th className="px-2 py-1.5">EMI</th><th className="px-2 py-1.5">Interest</th><th className="px-2 py-1.5">Balance</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {base.rows.map((r) => (
                  <tr key={r.index}>
                    <td className="px-2 py-1 text-left text-slate-500">{r.index}. {fmtDate(r.date)}</td>
                    <td className="px-2 py-1 text-slate-700">{formatINR(r.emi)}</td>
                    <td className="px-2 py-1 text-slate-400">{formatINR(r.interest)}</td>
                    <td className="px-2 py-1 font-medium text-slate-800">{formatINR(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* PLANNED (editable EMI) */}
        <div>
          <div className="mb-1.5 text-xs font-semibold text-indigo-700">Planned <span className="font-normal text-slate-400">· {planned.months} payments · closes {fmtDate(planned.closureDate)}</span></div>
          <div className="relative max-h-96 overflow-auto rounded-lg border border-indigo-100">
            {loading && (
              <div className="absolute inset-0 z-10 space-y-2 bg-white/70 p-3 backdrop-blur-sm">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="shimmer-block h-4 w-16 rounded" />
                    <div className="shimmer-block h-4 flex-1 rounded" />
                    <div className="shimmer-block h-4 w-20 rounded" />
                  </div>
                ))}
              </div>
            )}
            <table className="w-full min-w-[360px] text-right text-xs tabular-nums">
              <thead className="sticky top-0 bg-indigo-50 text-[10px] uppercase tracking-wide text-indigo-500">
                <tr><th className="px-2 py-1.5 text-left">Month</th><th className="px-2 py-1.5">EMI (edit)</th><th className="px-2 py-1.5">Interest</th><th className="px-2 py-1.5">Balance</th></tr>
              </thead>
              <tbody className="divide-y divide-indigo-50">
                {planned.rows.map((r) => {
                  const draft = drafts[r.index];
                  const edited = draft != null && Number(draft) !== r.emi;
                  return (
                    <tr key={r.index} className={edited ? "bg-amber-50" : undefined}>
                      <td className="px-2 py-1 text-left text-slate-500">{r.index}. {fmtDate(r.date)}</td>
                      <td className="px-1 py-0.5">
                        <input
                          value={draft ?? String(r.emi)}
                          onChange={(e) => setDrafts((d) => ({ ...d, [r.index]: e.target.value }))}
                          inputMode="decimal"
                          className="w-24 rounded border border-slate-200 px-1.5 py-1 text-right text-xs tabular-nums outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
                        />
                      </td>
                      <td className="px-2 py-1 text-slate-400">{formatINR(r.interest)}</td>
                      <td className="px-2 py-1 font-medium text-slate-800">{formatINR(r.balance)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, accent, good, bad }: { label: string; value: string; accent?: boolean; good?: boolean; bad?: boolean }) {
  const color = good ? "text-emerald-700" : bad ? "text-red-600" : accent ? "text-indigo-700" : "text-slate-800";
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
