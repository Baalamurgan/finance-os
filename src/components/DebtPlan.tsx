"use client";

// ── The payoff plan (plain-language, finance-expert recommendation) ───────────────────────────────
// The one thing a family member should see at a glance: which loan to attack first, why, and what a bit
// of spare cash each month buys them. All the detailed numbers/charts live in collapsed sections below
// and on each loan's own page. Runs the pure debt-rollover engine (correctly compounding the amortizing
// loans and holding interest-only loans flat) entirely in the browser.

import { useMemo, useState } from "react";
import { formatINR } from "@/lib/format";
import { compareDebtStrategies, avalancheOrder, type DebtLoan } from "@/lib/loan/strategy";

export type PlanLoan = DebtLoan & { interestOnly: boolean; monthlyInterest: number; closureDate: string | null };

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "—");
const fmtDateShort = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "—");
const fmtMonths = (m: number) => (m >= 12 ? `${Math.floor(m / 12)}y ${m % 12}m` : `${m} months`);
const andList = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function DebtPlan({ current, planned, hasPlan }: { current: PlanLoan[]; planned: PlanLoan[]; hasPlan: boolean }) {
  const [view, setView] = useState<"estimated" | "planned">("estimated");
  const loans = view === "planned" ? planned : current;

  const order = useMemo(() => avalancheOrder(loans).map((id) => loans.find((l) => l.id === id)!).filter(Boolean), [loans]);
  // No hypothetical extra: the debt-free date assumes you keep your current total monthly outgo and
  // redirect each loan's freed EMI to the next as it clears (the standard debt-rollover method).
  const cmp = useMemo(() => compareDebtStrategies(loans, 0), [loans]);

  if (current.length === 0) return null;

  const top = order[0];
  const interestOnly = order.filter((l) => l.interestOnly);
  const selfClosing = order.filter((l) => !l.interestOnly && l.closureDate);
  const ioBurnMonth = interestOnly.reduce((s, l) => s + l.monthlyInterest, 0);
  const ioBurnDay = Math.round((ioBurnMonth * 12) / 365);
  const rec = cmp.recommended === "avalanche" ? cmp.avalanche : cmp.snowball;
  const avalancheEdge = Math.round(cmp.snowball.totalInterest - cmp.avalanche.totalInterest);

  return (
    <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white">
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Your payoff plan</div>
          <div className="flex items-center gap-2">
            {view === "planned" && !hasPlan && <span className="text-[11px] text-slate-400">no saved plans yet</span>}
            <div className="inline-flex rounded-lg border border-indigo-200 bg-white/70 p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setView("estimated")}
                className={`rounded-md px-3 py-1 transition ${view === "estimated" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                Estimated
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
        {view === "planned" && hasPlan && (
          <p className="mt-1 text-[11px] text-slate-500">Starting from your saved loan plans, with the extra below on top.</p>
        )}

        {/* The headline recommendation, in one sentence. */}
        <h2 className="mt-1 text-lg font-bold leading-snug text-slate-900">
          Put spare cash on <span className="text-indigo-700">{top.name}</span> first
          {order[1] ? <>, then <span className="text-indigo-700">{order[1].name}</span></> : null}.
        </h2>

        {/* Why — the interest-only insight, the single biggest lever. */}
        {interestOnly.length > 0 && (
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {interestOnly.length > 1 ? "Your" : "The"} <b>{andList(interestOnly.map((l) => l.name))}</b>{" "}
            {interestOnly.length > 1 ? "loans are" : "loan is"} <b>interest-only</b> — the balance never drops on its own,
            so you pay <b className="text-rose-600">{formatINR(ioBurnMonth)}/month ({formatINR(ioBurnDay)}/day)</b> in
            pure interest with nothing coming off what you owe. That&apos;s your most expensive money, so clear the
            highest-rate one ({top.name}, {top.annualRatePct}%) first.
          </p>
        )}

        {/* The cheap, self-clearing loans — leave them be. */}
        {selfClosing.length > 0 && (
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            <b>{andList(selfClosing.map((l) => l.name))}</b> {selfClosing.length > 1 ? "are" : "is"} your cheapest debt
            and {selfClosing.length > 1 ? "clear" : "clears"} on {selfClosing.length > 1 ? "their" : "its"} own by{" "}
            <b>{fmtDate(selfClosing.map((l) => l.closureDate).sort().at(-1)!)}</b> just from the EMI — keep paying that,
            no need to rush extra money here.
          </p>
        )}

        {/* The outcome — when you'll be debt-free following this order. */}
        <div className="mt-4 rounded-xl border border-indigo-100 bg-white p-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <Result label="Debt-free by" value={rec.cleared ? fmtDateShort(rec.closureDate) : "—"} big />
            <Result label="In" value={rec.cleared ? fmtMonths(rec.months) : "—"} />
            <Result label="Total interest from here" value={formatINR(rec.totalInterest)} />
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Order: <b className="text-slate-700">{rec.orderNames.join(" → ")}</b>
            {avalancheEdge > 0 && cmp.recommended === "avalanche" && <> · avalanche saves {formatINR(avalancheEdge)} vs snowball</>}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Assumes you keep your current total monthly payment and redirect each loan&apos;s EMI to the next as it clears.
          </p>
        </div>

        {/* Everything else, folded away. */}
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-xs font-medium text-indigo-600 hover:text-indigo-800">
            <span className="group-open:hidden">▸ Compare the two strategies</span>
            <span className="hidden group-open:inline">▾ Compare the two strategies</span>
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StrategyCard title="Avalanche" subtitle="highest rate first — cheapest" order={cmp.avalanche.orderNames} interest={cmp.avalanche.totalInterest} months={cmp.avalanche.cleared ? cmp.avalanche.months : null} best={cmp.recommended === "avalanche"} />
            <StrategyCard title="Snowball" subtitle="smallest balance first — fast wins" order={cmp.snowball.orderNames} interest={cmp.snowball.totalInterest} months={cmp.snowball.cleared ? cmp.snowball.months : null} best={cmp.recommended === "snowball"} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            Both keep paying every EMI; the extra (plus each loan&apos;s freed EMI as it clears) goes to the priority loan.
            Interest is compounded monthly on the amortizing loans and held flat on the interest-only ones — a planning
            estimate, not a bank statement.
          </p>
        </details>
      </div>
    </section>
  );
}

function Result({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`font-bold tabular-nums text-slate-900 ${big ? "text-xl text-indigo-700" : "text-base"}`}>{value}</div>
    </div>
  );
}

function StrategyCard({ title, subtitle, order, interest, months, best }: { title: string; subtitle: string; order: string[]; interest: number; months: number | null; best: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${best ? "border-emerald-300 bg-emerald-50/50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-800">
          {title} {best && <span className="ml-1 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">pick</span>}
        </div>
        <span className="text-[10px] text-slate-400">{subtitle}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Total interest</div>
          <div className="text-sm font-bold tabular-nums text-slate-800">{formatINR(interest)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Debt-free in</div>
          <div className="text-sm font-bold tabular-nums text-slate-800">{months != null ? fmtMonths(months) : "—"}</div>
        </div>
      </div>
      <div className="mt-1.5 text-[10px] text-slate-400">{order.join(" → ")}</div>
    </div>
  );
}
