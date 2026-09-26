"use client";

// ── Payoff-order planner (avalanche vs snowball) ──────────────────────────────────────────────────
// You have some spare cash each month beyond the EMIs. Which loan should it attack first? This runs the
// pure debt-rollover engine (src/lib/loan/strategy) entirely in the browser: type an extra amount, hit
// Recalculate (brief shimmer), and see the two classic strategies side by side —
//   • Avalanche — highest interest rate first (cheapest overall).
//   • Snowball  — smallest balance first (fastest first win).
// Both roll each cleared loan's freed-up EMI onto the next. Planning estimate, same basis as the schedule.

import { useMemo, useState } from "react";
import { formatINR } from "@/lib/format";
import { compareDebtStrategies, type DebtLoan, type DebtPlan } from "@/lib/loan/strategy";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "—";
const fmtMonths = (m: number) => (m >= 12 ? `${Math.floor(m / 12)}y ${m % 12}m` : `${m}m`);

export function DebtStrategy({ loans }: { loans: DebtLoan[] }) {
  const [extraInput, setExtraInput] = useState("10000");
  const [committedExtra, setCommittedExtra] = useState(10000);
  const [loading, setLoading] = useState(false);

  const cmp = useMemo(() => compareDebtStrategies(loans, committedExtra), [loans, committedExtra]);
  const rec = cmp.recommended === "avalanche" ? cmp.avalanche : cmp.snowball;

  function recalc() {
    const n = Math.max(0, Math.round(Number(extraInput) || 0));
    setLoading(true);
    // A short, deliberate shimmer so the recompute reads as an action (the math itself is instant).
    setTimeout(() => {
      setCommittedExtra(n);
      setExtraInput(String(n));
      setLoading(false);
    }, 450);
  }

  if (loans.length < 1) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Payoff strategy <span className="text-xs font-normal text-slate-400">· which loan first</span>
        </h2>
        <div className="flex items-end gap-2">
          <label className="text-[11px] text-slate-500">
            Extra / month
            <div className="mt-0.5 flex items-center rounded-md border border-slate-200 px-2">
              <span className="text-xs text-slate-400">₹</span>
              <input
                value={extraInput}
                onChange={(e) => setExtraInput(e.target.value.replace(/[^0-9]/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && recalc()}
                inputMode="numeric"
                className="w-24 bg-transparent px-1 py-1.5 text-right text-xs tabular-nums outline-none"
              />
            </div>
          </label>
          <button
            type="button"
            onClick={recalc}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-white" /> : "↻"} Recalculate
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="shimmer-block h-16 flex-1 rounded-lg" />
              <div className="shimmer-block h-16 flex-1 rounded-lg" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {committedExtra <= 0 ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Enter a spare amount you can put toward debt each month to compare a real payoff plan. With EMIs
              alone{cmp.baseline.cleared ? "" : ", the interest-only (jewel) loans never reduce on their own"}.
            </p>
          ) : (
            <>
              {/* Recommendation banner */}
              <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2.5 text-xs text-slate-700">
                <div className="font-semibold text-indigo-900">
                  Attack order: {rec.orderNames.join(" → ")}
                </div>
                <div className="mt-0.5 text-slate-600">
                  Putting <b>{formatINR(committedExtra)}/mo</b> extra on the{" "}
                  <b>{cmp.recommended === "avalanche" ? "highest-rate" : "smallest"}</b> loan first
                  {cmp.interestSavedVsBaseline != null ? (
                    <> saves <b className="text-emerald-700">{formatINR(cmp.interestSavedVsBaseline)}</b> in interest and clears everything in <b>{fmtMonths(rec.months)}</b>.</>
                  ) : (
                    <> clears all debt in <b>{fmtMonths(rec.months)}</b> ({fmtDate(rec.closureDate)}) — without a plan the jewel loans wouldn&apos;t close at all.</>
                  )}
                </div>
              </div>

              {/* Side-by-side */}
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <StrategyCard title="Avalanche" subtitle="highest rate first" plan={cmp.avalanche} best={cmp.recommended === "avalanche"} />
                <StrategyCard title="Snowball" subtitle="smallest balance first" plan={cmp.snowball} best={cmp.recommended === "snowball"} />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                Both keep paying every EMI; the extra ₹{formatINR(committedExtra).replace("₹", "")} (plus each loan&apos;s
                freed EMI as it clears) goes to the priority loan. Avalanche minimises interest; snowball gives
                you a faster first win. Planning estimate — actuals track separately.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}

function StrategyCard({ title, subtitle, plan, best }: { title: string; subtitle: string; plan: DebtPlan; best: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${best ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-800">
          {title} {best && <span className="ml-1 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">best</span>}
        </div>
        <span className="text-[10px] text-slate-400">{subtitle}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Stat label="Total interest" value={formatINR(plan.totalInterest)} />
        <Stat label="Debt-free in" value={plan.cleared ? fmtMonths(plan.months) : "—"} />
      </div>
      <div className="mt-1.5 text-[10px] text-slate-400">
        Order: {plan.orderNames.join(" → ")}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-bold tabular-nums text-slate-800">{value}</div>
    </div>
  );
}
