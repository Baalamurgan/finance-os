import { formatINR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { loadPersonal } from "@/lib/loadPersonal";
import { personalMonthLabel } from "@/lib/personal";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { PersonalFixedModal } from "@/components/personal/PersonalFixedModal";
import { PersonalFixedRowActions } from "@/components/personal/PersonalFixedRowActions";
import { PersonalSpendFab } from "@/components/personal/PersonalSpendFab";
import { MoneyFlowDonut } from "@/components/Charts";
import { setPersonalIncome } from "@/app/personal/actions";

const COLORS = ["#0ea5e9", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#ec4899", "#84cc16", "#6366f1", "#f97316", "#06b6d4"];

export default async function PersonalSheet({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const nav = <PersonalNav active="sheet" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} />;

  if (!c.selected) {
    return (
      <>
        {nav}
        <main className="mx-auto max-w-2xl p-16 text-center text-slate-500">
          No data for {personalMonthLabel(c.selMonth, c.selYear)}.
        </main>
      </>
    );
  }

  const period = c.selected;
  const cats = new Map(c.categories.map((cat) => [cat.id, cat]));
  const catList = c.categories.map((cat) => ({ id: cat.id, name: cat.name, icon: cat.icon }));

  const [expenses, spendAgg] = await Promise.all([
    prisma.personalExpense.findMany({ where: { periodId: period.id }, orderBy: { amount: "desc" } }),
    prisma.personalSpend.aggregate({ where: { periodId: period.id }, _sum: { amount: true } }),
  ]);
  const expensesTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const spendsTotal = spendAgg._sum.amount ?? 0;
  const totalIn = period.income + period.carryForward;
  const balance = totalIn - expensesTotal;
  const left = balance - spendsTotal;

  // group expenses by category (collapsible, like family)
  const byCat = new Map<number, { total: number; items: typeof expenses }>();
  for (const e of expenses) {
    const key = e.categoryId ?? 0;
    const g = byCat.get(key) ?? { total: 0, items: [] };
    g.total += e.amount;
    g.items.push(e);
    byCat.set(key, g);
  }
  const groups = [...byCat.entries()].map(([id, g]) => ({ cat: cats.get(id), ...g })).sort((a, b) => b.total - a.total);

  const segments = [
    ...groups.map((g, i) => ({ name: g.cat ? `${g.cat.icon ?? ""} ${g.cat.name}`.trim() : "Uncategorised", value: g.total, color: COLORS[i % COLORS.length] })),
    ...(spendsTotal > 0 ? [{ name: "Daily spends", value: spendsTotal, color: "#3f6152" }] : []),
    ...(left > 0 ? [{ name: "Left over", value: left, color: "#22c55e" }] : []),
  ].filter((s) => s.value > 0);

  return (
    <>
      {nav}
      <main className="mx-auto max-w-3xl space-y-4 p-4 pb-28 sm:p-6">
        <h1 className="text-xl font-bold text-slate-900">{period.label}</h1>

        {/* salary + previous-month remaining */}
        <div className="rounded-xl border border-emerald-200 bg-white p-4">
          <form action={setPersonalIncome} className="flex items-center justify-between gap-2">
            <input type="hidden" name="periodId" value={period.id} />
            <span className="text-sm font-medium text-slate-600">Salary</span>
            <span className="flex items-center gap-1">
              <span className="text-slate-400">₹</span>
              <input name="income" type="number" step="0.01" defaultValue={period.income} className="w-32 rounded-md border border-slate-200 px-2 py-1 text-right text-lg font-bold tabular-nums outline-none focus:border-emerald-400" />
              <button className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700">Save</button>
            </span>
          </form>
          {period.carryForward !== 0 && (
            <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-sm">
              <span className="text-slate-500">Previous month remaining</span>
              <span className={`tabular-nums font-medium ${period.carryForward < 0 ? "text-red-600" : "text-slate-700"}`}>{formatINR(period.carryForward)}</span>
            </div>
          )}
        </div>

        {/* stats — stack on mobile (fixes the overlap) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Total in" value={formatINR(totalIn)} />
          <Stat label="Expenses" value={formatINR(expensesTotal)} />
          <Stat label="Balance" value={formatINR(balance)} accent={balance >= 0} danger={balance < 0} />
        </div>

        {totalIn > 0 && segments.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-800">Where the money went</h2>
            <p className="mb-4 text-xs text-slate-500">{formatINR(totalIn)} in · expenses, daily spends and what&apos;s left.</p>
            <MoneyFlowDonut segments={segments} centerLabel="In" centerValue={formatINR(totalIn)} />
          </div>
        )}

        {/* collapsible Expense section */}
        <details open className="rounded-xl border border-red-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between border-l-4 border-red-500 bg-red-50 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="text-sm font-bold uppercase tracking-widest text-red-700">Expenses</span>
            <span className="text-lg font-extrabold tabular-nums text-red-700">{formatINR(expensesTotal)}</span>
          </summary>
          <div className="px-2 py-1">
            {groups.length === 0 ? (
              <p className="px-2 py-3 text-sm text-slate-400">No expenses yet — add rent, bills, subscriptions…</p>
            ) : (
              groups.map((g) => (
                <details key={g.cat?.id ?? 0} open className="border-b border-slate-100 last:border-0">
                  <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2 py-2 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {g.cat ? `${g.cat.icon ?? ""} ${g.cat.name}` : "Uncategorised"} <span className="text-[10px] text-slate-400">({g.items.length})</span>
                    </span>
                    <span className="text-sm font-bold tabular-nums text-slate-700">{formatINR(g.total)}</span>
                  </summary>
                  <div className="divide-y divide-slate-100 px-2 pb-1">
                    {g.items.map((e) => (
                      <div key={e.id} className="flex items-center justify-between py-2 text-sm">
                        <span className="text-slate-700">
                          {e.label}
                          {!e.recurring && <span className="ml-2 text-[10px] text-slate-400">(one-off)</span>}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="tabular-nums text-slate-700">{formatINR(e.amount)}</span>
                          <PersonalFixedRowActions periodId={period.id} categories={catList} initial={{ id: e.id, label: e.label, categoryId: e.categoryId, amount: e.amount, recurring: e.recurring }} />
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              ))
            )}
            <div className="px-2 py-2">
              <PersonalFixedModal periodId={period.id} categories={catList} defaultRecurring={false} />
            </div>
          </div>
        </details>

        <p className="text-center text-xs text-slate-400">Daily spends live in the <b>Expenses</b> tab and draw down your balance.</p>
      </main>

      <PersonalSpendFab periodId={period.id} categories={catList} remaining={left} />
    </>
  );
}

function Stat({ label, value, accent, danger }: { label: string; value: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${danger ? "text-red-600" : accent ? "text-emerald-700" : "text-slate-800"}`}>{value}</div>
    </div>
  );
}
