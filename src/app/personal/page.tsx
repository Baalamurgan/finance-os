import { formatINR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { loadPersonal } from "@/lib/loadPersonal";
import { personalMonthLabel, personalCycleRange } from "@/lib/personal";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { PersonalFixedModal } from "@/components/personal/PersonalFixedModal";
import { PersonalFixedRowActions } from "@/components/personal/PersonalFixedRowActions";
import { PersonalSpendFab } from "@/components/personal/PersonalSpendFab";
import { PersonalEmpty } from "@/components/personal/PersonalEmpty";
import { MoneyFlowDonut } from "@/components/Charts";
import { setPersonalIncome, addPersonalIncome, deletePersonalIncome } from "@/app/personal/actions";

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
        <PersonalEmpty label={personalMonthLabel(c.selMonth, c.selYear)} />
      </>
    );
  }

  const period = c.selected;
  const cats = new Map(c.categories.map((cat) => [cat.id, cat]));
  const catList = c.categories.map((cat) => ({ id: cat.id, name: cat.name, icon: cat.icon }));

  const [expenses, spendAgg, extraIncomes] = await Promise.all([
    prisma.personalExpense.findMany({ where: { periodId: period.id }, orderBy: { amount: "desc" } }),
    prisma.personalSpend.aggregate({ where: { periodId: period.id }, _sum: { amount: true } }),
    prisma.personalIncome.findMany({ where: { periodId: period.id }, orderBy: { id: "desc" } }),
  ]);
  const monthlyExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const spentTotal = spendAgg._sum.amount ?? 0;
  const extraTotal = extraIncomes.reduce((s, i) => s + i.amount, 0);
  const totalIn = period.income + period.carryForward + extraTotal;
  // Personal expense = what you can spend this month (planned, excludes daily spends)
  const personalExpense = totalIn - monthlyExpenses;
  const remaining = personalExpense - spentTotal;
  const spentPct = personalExpense > 0 ? Math.min(100, (spentTotal / personalExpense) * 100) : 0;

  // group monthly expenses by category (collapsible)
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
    ...(personalExpense > 0 ? [{ name: "Personal expense (to spend)", value: personalExpense, color: "#22c55e" }] : []),
  ].filter((s) => s.value > 0);

  return (
    <>
      {nav}
      <main className="mx-auto max-w-3xl space-y-4 p-4 pb-28 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{period.label}</h1>
          {personalCycleRange(period.year, period.month, c.member.personalWindDownDay) && (
            <p className="text-xs text-slate-400">{personalCycleRange(period.year, period.month, c.member.personalWindDownDay)} · your cycle</p>
          )}
        </div>

        {/* salary + carry + extra income */}
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
          {extraIncomes.map((i) => (
            <div key={i.id} className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-sm">
              <span className="text-slate-500">{i.source}</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums font-medium text-emerald-700">+{formatINR(i.amount)}</span>
                <form action={deletePersonalIncome}>
                  <input type="hidden" name="id" value={i.id} />
                  <button className="text-xs text-slate-300 hover:text-red-600">✕</button>
                </form>
              </span>
            </div>
          ))}
          <details className="mt-2 border-t border-slate-100 pt-2">
            <summary className="cursor-pointer text-xs font-medium text-emerald-700">+ Add extra income (gift, top-up)</summary>
            <form action={addPersonalIncome} className="mt-2 flex gap-2">
              <input type="hidden" name="periodId" value={period.id} />
              <input name="source" placeholder="e.g. Dad gave" required className="input flex-1" />
              <input name="amount" type="number" step="0.01" placeholder="₹" required className="input w-24" />
              <button className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white">Add</button>
            </form>
          </details>
        </div>

        {/* stats (stack on mobile) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Total in" value={formatINR(totalIn)} />
          <Stat label="Monthly expenses" value={formatINR(monthlyExpenses)} />
          <Stat label="Personal expense" value={formatINR(personalExpense)} accent={personalExpense >= 0} danger={personalExpense < 0} sub="you can spend this" />
        </div>

        {/* spendable progress (already spent) */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium text-slate-700">Spent this month</span>
            <span className="tabular-nums text-slate-500">
              {formatINR(spentTotal)} of {formatINR(Math.max(0, personalExpense))}
            </span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${spentTotal > personalExpense ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${spentPct}%` }} />
          </div>
          <div className={`mt-1 text-xs ${remaining < 0 ? "text-red-600" : "text-slate-400"}`}>
            {remaining >= 0 ? `${formatINR(remaining)} left to spend` : `Over by ${formatINR(-remaining)}`}
          </div>
        </div>

        {totalIn > 0 && segments.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-800">Where the income goes</h2>
            <p className="mb-4 text-xs text-slate-500">{formatINR(totalIn)} in · fixed monthly bills vs what&apos;s yours to spend.</p>
            <MoneyFlowDonut segments={segments} centerLabel="In" centerValue={formatINR(totalIn)} />
          </div>
        )}

        {/* monthly expenses (collapsible) */}
        <details open className="rounded-xl border border-red-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between border-l-4 border-red-500 bg-red-50 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="text-sm font-bold uppercase tracking-widest text-red-700">Monthly expenses</span>
            <span className="text-lg font-extrabold tabular-nums text-red-700">{formatINR(monthlyExpenses)}</span>
          </summary>
          <div className="px-2 py-1">
            {groups.length === 0 ? (
              <p className="px-2 py-3 text-sm text-slate-400">No fixed expenses yet — add rent, bills, subscriptions…</p>
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

        <p className="text-center text-xs text-slate-400">Daily spends live in the <b>Expenses</b> tab and draw down your personal expense.</p>
      </main>

      <PersonalSpendFab periodId={period.id} categories={catList} remaining={remaining} />
    </>
  );
}

function Stat({ label, value, accent, danger, sub }: { label: string; value: string; accent?: boolean; danger?: boolean; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${danger ? "text-red-600" : accent ? "text-emerald-700" : "text-slate-800"}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}
