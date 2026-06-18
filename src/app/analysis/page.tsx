import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getRollup } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { CategoryBars, SplitPie } from "@/components/Charts";

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) {
    return (
      <main className="mx-auto max-w-2xl p-10 text-center text-slate-600">
        Nothing to analyse yet.
      </main>
    );
  }

  const nav = (
    <NavHeader
      active="analysis"
      householdName={c.household.name}
      selYear={c.selYear}
      selMonth={c.selMonth}
      members={c.members}
      categories={c.categories}
      account={c.account}
      isHead={c.isHead}
      piggyBalance={c.piggyBalance}
      periodId={c.selected?.id ?? null}
      periodOpen={c.selected?.status === "open"}
    />
  );

  if (c.noData || !c.selected) {
    return (
      <>
        {nav}
        <main className="mx-auto max-w-2xl p-16 text-center text-slate-500">
          No data to analyse for this month.
        </main>
      </>
    );
  }

  const rollup = await getRollup(c.selected.id);

  return (
    <>
      {nav}
      <main className="mx-auto max-w-7xl space-y-8 p-6">
        <h1 className="text-xl font-bold text-slate-900">{c.selected.label} — analysis</h1>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card label="Total Income" value={formatINR(rollup.totalIncome)} tone="green" />
          <Card label="Total Expense" value={formatINR(rollup.totalExpense)} tone="red" />
          <Card label="Balance" value={formatINR(rollup.balance)} tone="indigo" />
        </section>

        {/* priority: budget vs spent table first */}
        <BudgetVsSpent rows={rollup.byCategory} />

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700">Budget vs Spent by category</h2>
            <p className="mb-2 text-xs text-slate-400">
              Budget = what you planned for the month · Spent = total recorded in that category.
            </p>
            <CategoryBars data={rollup.byCategory} />
          </div>
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Necessary vs other</h2>
              <SplitPie data={rollup.necessaryVsOther} />
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-700">By member</h2>
              <SplitPie data={rollup.byMember.map((m) => ({ name: m.name, value: m.total }))} />
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

function BudgetVsSpent({
  rows,
}: {
  rows: { name: string; actual: number; planned: number }[];
}) {
  const budgeted = rows.filter((r) => r.planned > 0);
  const unbudgeted = rows.filter((r) => r.planned === 0 && r.actual > 0);
  const totalBudget = budgeted.reduce((s, r) => s + r.planned, 0);
  const totalSpentOnBudget = budgeted.reduce((s, r) => s + r.actual, 0);
  const remaining = totalBudget - totalSpentOnBudget;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Budget vs Spent</h2>
        {totalBudget > 0 && (
          <p className="text-xs text-slate-500">
            Spent <b className="text-slate-700">{formatINR(totalSpentOnBudget)}</b> of{" "}
            <b className="text-slate-700">{formatINR(totalBudget)}</b> budgeted —{" "}
            <span className={remaining >= 0 ? "font-semibold text-green-600" : "font-semibold text-red-600"}>
              {remaining >= 0 ? "under by " : "over by "}
              {formatINR(Math.abs(remaining))}
            </span>
          </p>
        )}
      </div>

      {budgeted.length > 0 ? (
        <div className="space-y-3">
          {budgeted.map((r) => {
            const pct = Math.min((r.actual / r.planned) * 100, 100);
            const over = r.actual > r.planned;
            return (
              <div key={r.name}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700">{r.name}</span>
                  <span className="tabular-nums text-slate-500">
                    {formatINR(r.actual)}{" "}
                    <span className="text-slate-400">/ {formatINR(r.planned)}</span>
                    <span className={`ml-2 font-medium ${over ? "text-red-600" : "text-green-600"}`}>
                      {over ? "over" : `${Math.round((r.actual / r.planned) * 100)}%`}
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${over ? "bg-red-500" : "bg-indigo-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          No budgets set yet. Budgets let you track spending against a monthly plan.
        </p>
      )}

      {unbudgeted.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-3">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
            Spending with no budget set
          </div>
          <ul className="space-y-1 text-sm">
            {unbudgeted.map((r) => (
              <li key={r.name} className="flex justify-between">
                <span className="text-slate-600">{r.name}</span>
                <span className="tabular-nums text-slate-700">{formatINR(r.actual)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "green" | "red" | "indigo";
}) {
  const tones = {
    green: "from-green-50 to-white text-green-700",
    red: "from-red-50 to-white text-red-700",
    indigo: "from-indigo-50 to-white text-indigo-700",
  } as const;
  return (
    <div className={`rounded-xl border border-slate-200 bg-gradient-to-br p-5 ${tones[tone]}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
