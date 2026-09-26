"use client";

import { useMemo, useState, useTransition } from "react";
import { amortize, round2, type EmiOverride, type Prepayment } from "@/lib/loan/amortize";
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
  savedOverrides: EmiOverride[]; // saved what-if per-month EMI edits
  savedPrepayments: Prepayment[]; // saved what-if per-month prepayment edits
  plannedPrepayments: Prepayment[]; // unpaid linked Sheet prepayments — folded into Planned until paid
  maxMonths?: number; // horizon cap for interest-only loans (payment ≈ interest, balance ~flat)
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) : "—");
const keyOf = (ov: EmiOverride[]) => JSON.stringify([...ov].sort((a, b) => a.monthIndex - b.monthIndex));

export function LoanScheduleWhatIf({ loanId, canEdit, outstanding, annualRatePct, emi, startISO, startIndex, savedOverrides, savedPrepayments, plannedPrepayments, maxMonths }: Props) {
  const toast = useToast();
  const [savingPending, startSaving] = useTransition();
  const prepayKey = JSON.stringify(plannedPrepayments);
  // Current = keep paying the normal EMI from your actual balance (paid items are already in `outstanding`).
  const base = useMemo(
    () => amortize({ principal: outstanding, annualRatePct, emi, startDate: startISO, startIndex, maxMonths }),
    [outstanding, annualRatePct, emi, startISO, startIndex, maxMonths],
  );

  const [emiDrafts, setEmiDrafts] = useState<Record<number, string>>({}); // monthIndex → typed EMI
  const [preDrafts, setPreDrafts] = useState<Record<number, string>>({}); // monthIndex → typed prepayment
  const [committedEmi, setCommittedEmi] = useState<EmiOverride[]>(savedOverrides);
  const [committedPre, setCommittedPre] = useState<Prepayment[]>(savedPrepayments);
  const [loading, setLoading] = useState(false);

  // Effective prepayments = the Sheet's linked prepayments, with your what-if prepay edits layered on top
  // (an edit to a month overrides that month; 0 removes it). Filtered to > 0 for the schedule.
  const effectivePre = (): Prepayment[] => {
    const m = new Map<number, number>();
    for (const p of plannedPrepayments) m.set(p.monthIndex, p.amount);
    for (const p of committedPre) m.set(p.monthIndex, p.amount);
    return [...m.entries()].filter(([, a]) => a > 0).map(([monthIndex, amount]) => ({ monthIndex, amount }));
  };

  // Planned = Current + everything not-yet-paid: unpaid linked Sheet prepayments AND your what-if EMI +
  // prepayment edits. When a Sheet item is marked paid it leaves this list (→ `outstanding` → Current).
  const preKey = JSON.stringify(committedPre);
  const planned = useMemo(
    () => amortize({ principal: outstanding, annualRatePct, emi, startDate: startISO, startIndex, emiOverrides: committedEmi, prepayments: effectivePre(), maxMonths }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [committedEmi, preKey, outstanding, annualRatePct, emi, startISO, startIndex, prepayKey, maxMonths],
  );

  // Merge a committed list with typed drafts (drafts win). Used on Recalculate/Save.
  const collectEmi = (): EmiOverride[] => {
    const map = new Map<number, number>();
    for (const o of committedEmi) map.set(o.monthIndex, o.emi);
    for (const [k, v] of Object.entries(emiDrafts)) { const n = Number(v); if (Number.isFinite(n) && n >= 0) map.set(Number(k), n); }
    return [...map.entries()].map(([monthIndex, emi]) => ({ monthIndex, emi }));
  };
  const collectPre = (): Prepayment[] => {
    const map = new Map<number, number>();
    for (const p of committedPre) map.set(p.monthIndex, p.amount);
    for (const [k, v] of Object.entries(preDrafts)) { const n = Number(v); if (Number.isFinite(n) && n >= 0) map.set(Number(k), n); }
    return [...map.entries()].map(([monthIndex, amount]) => ({ monthIndex, amount }));
  };

  const dirty = Object.keys(emiDrafts).length > 0 || Object.keys(preDrafts).length > 0 || committedEmi.length > 0 || committedPre.length > 0;
  const savedKey = keyOf(savedOverrides) + "|" + JSON.stringify([...savedPrepayments].sort((a, b) => a.monthIndex - b.monthIndex));
  const curKey = keyOf(collectEmi()) + "|" + JSON.stringify([...collectPre()].sort((a, b) => a.monthIndex - b.monthIndex));
  const unsaved = curKey !== savedKey;
  const interestSaved = round2(base.totalInterest - planned.totalInterest);
  const monthsSaved = base.months - planned.months;

  const recalc = () => {
    const e = collectEmi(); const p = collectPre();
    setLoading(true);
    setTimeout(() => {
      setCommittedEmi(e); setCommittedPre(p); setEmiDrafts({}); setPreDrafts({}); setLoading(false);
    }, 650);
  };
  const revert = () => {
    setEmiDrafts({}); setPreDrafts({}); setCommittedEmi([]); setCommittedPre([]);
  };
  const savePlan = () => {
    const overrides = collectEmi(); const prepayments = collectPre();
    setCommittedEmi(overrides); setCommittedPre(prepayments); setEmiDrafts({}); setPreDrafts({});
    startSaving(async () => {
      const res = await saveLoanPlan(loanId, { overrides, prepayments });
      const has = overrides.length > 0 || prepayments.some((x) => x.amount > 0);
      toast(res.ok ? (has ? "Plan saved" : "Plan cleared") : "Couldn't save the plan", res.ok ? "success" : "error");
    });
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Repayment schedule <span className="text-xs font-normal text-slate-400">· what-if</span>
          {canEdit && (unsaved ? <span className="ml-1.5 text-[11px] font-normal text-amber-600">· unsaved</span> : savedOverrides.length > 0 || savedPrepayments.length > 0 ? <span className="ml-1.5 text-[11px] font-normal text-emerald-600">· plan saved</span> : null)}
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
        <Metric label="Planned interest left" value={formatINR(planned.totalInterest)} accent={committedEmi.length > 0 || committedPre.length > 0} />
        <Metric label="Interest saved" value={`${interestSaved >= 0 ? "" : "+"}${formatINR(Math.abs(interestSaved))}`} good={interestSaved > 0} bad={interestSaved < 0} />
        <Metric label="Months saved" value={`${monthsSaved >= 0 ? "" : "+"}${Math.abs(monthsSaved)} mo`} good={monthsSaved > 0} bad={monthsSaved < 0} />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        In <b>Planned</b>, edit the <b className="text-slate-500">EMI</b> (full monthly payment = Principal + Interest) <b>and</b> the <b className="text-emerald-700">Prepay</b> (extra principal) for any month — just like the Sheet — then Recalculate. Your unpaid Sheet items pre-fill it; when a Sheet item is marked <b>Paid</b> it moves from Planned into <b>Current</b> (the actual balance). Planning estimate.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* CURRENT (read-only) */}
        <div>
          <div className="mb-1.5 text-xs font-semibold text-slate-600">Current <span className="font-normal text-slate-400">· {base.months} payments · closes {fmtDate(base.closureDate)}</span></div>
          <div className="max-h-96 overflow-auto rounded-lg border border-slate-100">
            <table className="w-full min-w-[460px] text-right text-xs tabular-nums">
              <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-1.5 text-left">Month</th>
                  <th className="px-2 py-1.5" title="Full monthly payment (principal + interest)">EMI</th>
                  <th className="px-2 py-1.5">Principal</th>
                  <th className="px-2 py-1.5">Interest</th>
                  <th className="px-2 py-1.5">Prepay</th>
                  <th className="px-2 py-1.5">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {base.rows.map((r) => (
                  <tr key={r.index}>
                    <td className="px-2 py-1 text-left text-slate-500">{r.index}. {fmtDate(r.date)}</td>
                    <td className="px-2 py-1 text-slate-700">{formatINR(r.emi)}</td>
                    <td className="px-2 py-1 text-slate-600">{formatINR(r.principal)}</td>
                    <td className="px-2 py-1 text-slate-400">{formatINR(r.interest)}</td>
                    <td className="px-2 py-1 text-slate-300">—</td>
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
            <table className="w-full min-w-[500px] text-right text-xs tabular-nums">
              <thead className="sticky top-0 bg-indigo-50 text-[10px] uppercase tracking-wide text-indigo-500">
                <tr>
                  <th className="px-2 py-1.5 text-left">Month</th>
                  <th className="px-2 py-1.5" title="Full monthly payment you'd make — edit it">EMI ✎</th>
                  <th className="px-2 py-1.5">Principal</th>
                  <th className="px-2 py-1.5">Interest</th>
                  <th className="px-2 py-1.5">Prepay</th>
                  <th className="px-2 py-1.5">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-indigo-50">
                {planned.rows.map((r) => {
                  const emiDraft = emiDrafts[r.index];
                  const preDraft = preDrafts[r.index];
                  const edited = (emiDraft != null && Number(emiDraft) !== r.emi) || (preDraft != null && Number(preDraft) !== r.prepayment);
                  return (
                    <tr key={r.index} className={edited ? "bg-amber-50" : r.prepayment > 0 ? "bg-emerald-50" : undefined}>
                      <td className="px-2 py-1 text-left text-slate-500">{r.index}. {fmtDate(r.date)}</td>
                      <td className="px-1 py-0.5">
                        <input
                          value={emiDraft ?? String(r.emi)}
                          onChange={(e) => setEmiDrafts((d) => ({ ...d, [r.index]: e.target.value }))}
                          inputMode="decimal"
                          aria-label={`EMI for month ${r.index}`}
                          className="w-24 rounded border border-slate-200 px-1.5 py-1 text-right text-xs tabular-nums outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
                        />
                      </td>
                      <td className="px-2 py-1 text-slate-600">{formatINR(r.principal)}</td>
                      <td className="px-2 py-1 text-slate-400">{formatINR(r.interest)}</td>
                      <td className="px-1 py-0.5">
                        <input
                          value={preDraft ?? (r.prepayment > 0 ? String(r.prepayment) : "")}
                          onChange={(e) => setPreDrafts((d) => ({ ...d, [r.index]: e.target.value }))}
                          inputMode="decimal"
                          placeholder="0"
                          aria-label={`Prepayment for month ${r.index}`}
                          className="w-24 rounded border border-emerald-200 bg-emerald-50/40 px-1.5 py-1 text-right text-xs font-medium tabular-nums text-emerald-800 outline-none placeholder:font-normal placeholder:text-emerald-300 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-100"
                        />
                      </td>
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
