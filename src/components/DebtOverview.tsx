"use client";

// ── Debt overview cockpit (with a Current ↔ Planned toggle) ───────────────────────────────────────
// The whole-picture debt numbers + a combined balance-to-zero chart. A segmented switch flips every
// figure and the graph between two trajectories, mirroring each loan's own Current/Planned columns:
//   • Current — every loan on its normal EMI, no plan.
//   • Planned — each loan's saved what-if plan + its unpaid linked Sheet prepayments.
// The two share one x-axis horizon so the curve morphs in place when you toggle.

import { useState } from "react";
import { formatINR } from "@/lib/format";
import { DebtBalanceTrend } from "@/components/Charts";
import type { DebtView } from "@/lib/queries";

const monthLabel = (offset: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
};
const fmtClosure = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "—";

export function DebtOverview({ current, planned, hasPlan, interestSaved }: { current: DebtView; planned: DebtView; hasPlan: boolean; interestSaved: number }) {
  const [view, setView] = useState<"current" | "planned">("current");
  const d = view === "planned" ? planned : current;
  const chartData = d.timeline.map((t) => ({ label: monthLabel(t.monthIndex), balance: t.balance }));
  const showSaving = view === "planned" && hasPlan && interestSaved > 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Debt overview</h2>
        <div className="flex items-center gap-2">
          {view === "planned" && !hasPlan && <span className="text-[11px] text-slate-400">no saved plans yet</span>}
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => setView("current")}
              className={`rounded-md px-3 py-1 transition ${view === "current" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              Current
            </button>
            <button
              type="button"
              onClick={() => setView("planned")}
              className={`rounded-md px-3 py-1 transition ${view === "planned" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              Planned
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Cockpit label="Outstanding" value={formatINR(d.totalOutstanding)} accent />
        <Cockpit label="Blended rate" value={d.blendedRate != null ? `${d.blendedRate}%` : "—"} hint="weighted by balance" />
        <Cockpit label="Interest / day" value={formatINR(d.dailyInterest)} hint={`${formatINR(d.totalMonthlyInterest)}/mo`} bad />
        <Cockpit
          label="Debt-free"
          value={d.debtFreeDate ? fmtClosure(d.debtFreeDate) : "Needs a plan"}
          hint={d.hasOpenEnded ? "some loans don't self-close" : undefined}
        />
        <Cockpit
          label="Interest remaining"
          value={d.totalInterestRemaining > 0 ? formatINR(d.totalInterestRemaining) : "—"}
          hint={showSaving ? `saves ${formatINR(interestSaved)}` : "total until debt-free"}
          good={showSaving}
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-xs font-medium text-slate-500">
            Projected balance to zero <span className="text-slate-400">· {view === "planned" ? "with your plan" : "no extra payments"}</span>
          </div>
          <span className="text-[11px] text-slate-400">planning estimate</span>
        </div>
        <DebtBalanceTrend data={chartData} />
        <p className="mt-1 text-[11px] text-slate-400">
          Follows the payoff order — keep your current total monthly payment and redirect each loan&apos;s EMI
          to the next as it clears.{d.hasInterestOnly ? " Interest-only (jewel) debt stays flat until the plan reaches it, then drops to zero." : ""}
        </p>
      </div>
    </section>
  );
}

function Cockpit({ label, value, hint, accent, bad, good }: { label: string; value: string; hint?: string; accent?: boolean; bad?: boolean; good?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-base font-bold tabular-nums ${accent ? "text-indigo-700" : bad ? "text-rose-600" : "text-slate-800"}`}>{value}</div>
      {hint && <div className={`text-[10px] ${good ? "font-medium text-emerald-600" : "text-slate-400"}`}>{hint}</div>}
    </div>
  );
}
