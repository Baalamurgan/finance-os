import { formatINR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { loadPersonal } from "@/lib/loadPersonal";
import { personalMonthLabel } from "@/lib/personal";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { PersonalSpendFab } from "@/components/personal/PersonalSpendFab";
import { PersonalSpendsView } from "@/components/personal/PersonalSpendsView";
import { PersonalEmpty } from "@/components/personal/PersonalEmpty";
import { MoneyFlowDonut } from "@/components/Charts";
import { addPersonalCategory, archivePersonalCategory } from "@/app/personal/actions";

const COLORS = ["#059669", "#0ea5e9", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#ec4899", "#84cc16", "#6366f1", "#f97316"];

export default async function PersonalExpenses({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const nav = <PersonalNav active="expenses" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} />;

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

  const [fixedAgg, extraAgg, spends] = await Promise.all([
    prisma.personalExpense.aggregate({ where: { periodId: period.id }, _sum: { amount: true } }),
    prisma.personalIncome.aggregate({ where: { periodId: period.id }, _sum: { amount: true } }),
    prisma.personalSpend.findMany({ where: { periodId: period.id }, orderBy: [{ date: "desc" }, { id: "desc" }] }),
  ]);
  const totalIn = period.income + period.carryForward + (extraAgg._sum.amount ?? 0);
  const personalExpense = totalIn - (fixedAgg._sum.amount ?? 0);
  const spentTotal = spends.reduce((s, e) => s + e.amount, 0);
  const remaining = personalExpense - spentTotal;

  const byCat = new Map<number, number>();
  for (const s of spends) byCat.set(s.categoryId, (byCat.get(s.categoryId) ?? 0) + s.amount);
  const groups = [...byCat.entries()].map(([id, total]) => ({ cat: cats.get(id), total })).filter((g) => g.cat).sort((a, b) => b.total - a.total);
  const segments = [
    ...groups.map((g, i) => ({ name: `${g.cat!.icon ?? ""} ${g.cat!.name}`.trim(), value: g.total, color: COLORS[i % COLORS.length] })),
    ...(remaining > 0 ? [{ name: "Remaining", value: remaining, color: "#22c55e" }] : []),
  ].filter((s) => s.value > 0);

  const spendsForClient = spends.map((s) => ({
    id: s.id,
    categoryId: s.categoryId,
    amount: s.amount,
    note: s.note,
    date: s.date.toISOString(),
  }));

  return (
    <>
      {nav}
      <main className="mx-auto max-w-3xl space-y-4 p-4 pb-28 sm:p-6">
        <h1 className="text-xl font-bold text-slate-900">{period.label} — spends</h1>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Can spend</div>
            <div className="mt-1 text-xl font-bold text-slate-800">{formatINR(personalExpense)}</div>
            <div className="text-[10px] text-slate-400">personal expense this month</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Spent</div>
            <div className="mt-1 text-xl font-bold text-slate-800">{formatINR(spentTotal)}</div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">Remaining</div>
            <div className={`mt-1 text-xl font-bold ${remaining >= 0 ? "text-emerald-800" : "text-red-600"}`}>{formatINR(remaining)}</div>
          </div>
        </div>

        {spends.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">By category</h2>
            <MoneyFlowDonut segments={segments} centerLabel="Spent" centerValue={formatINR(spentTotal)} />
          </div>
        )}

        <PersonalSpendsView spends={spendsForClient} categories={catList} periodId={period.id} />

        {/* manage spend categories */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Spend categories</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {c.categories.map((cat) => (
              <form key={cat.id} action={archivePersonalCategory}>
                <input type="hidden" name="id" value={cat.id} />
                <button className="flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50" title="Archive">
                  {cat.icon} {cat.name} <span className="text-slate-300">×</span>
                </button>
              </form>
            ))}
          </div>
          <form action={addPersonalCategory} className="mt-3 flex gap-2">
            <input name="icon" placeholder="🔖" maxLength={2} className="input w-14 text-center" />
            <input name="name" placeholder="New category" className="input flex-1" required />
            <button className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900 dark:bg-slate-950">Add</button>
          </form>
        </section>
      </main>

      <PersonalSpendFab periodId={period.id} categories={catList} remaining={remaining} />
    </>
  );
}
