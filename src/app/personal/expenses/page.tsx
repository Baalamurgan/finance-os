import { formatINR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { loadPersonal } from "@/lib/loadPersonal";
import { personalMonthLabel } from "@/lib/personal";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { PersonalSpendModal } from "@/components/personal/PersonalSpendModal";
import { PersonalSpendRowActions } from "@/components/personal/PersonalSpendRowActions";
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
        <main className="mx-auto max-w-2xl p-16 text-center text-slate-500">
          No data for {personalMonthLabel(c.selMonth, c.selYear)}.
        </main>
      </>
    );
  }

  const period = c.selected;
  const cats = new Map(c.categories.map((cat) => [cat.id, cat]));
  const [fixedAgg, spends] = await Promise.all([
    prisma.personalExpense.aggregate({ where: { periodId: period.id }, _sum: { amount: true } }),
    prisma.personalSpend.findMany({ where: { periodId: period.id }, orderBy: [{ date: "desc" }, { id: "desc" }] }),
  ]);
  const available = period.income - (fixedAgg._sum.amount ?? 0);
  const spentTotal = spends.reduce((s, e) => s + e.amount, 0);
  const remaining = available - spentTotal;

  const byCat = new Map<number, { total: number; items: typeof spends }>();
  for (const s of spends) {
    const g = byCat.get(s.categoryId) ?? { total: 0, items: [] };
    g.total += s.amount;
    g.items.push(s);
    byCat.set(s.categoryId, g);
  }
  const groups = [...byCat.entries()]
    .map(([id, g]) => ({ cat: cats.get(id), ...g }))
    .filter((g) => g.cat)
    .sort((a, b) => b.total - a.total);

  const segments = [
    ...groups.map((g, i) => ({ name: `${g.cat!.icon ?? ""} ${g.cat!.name}`.trim(), value: g.total, color: COLORS[i % COLORS.length] })),
    ...(remaining > 0 ? [{ name: "Remaining", value: remaining, color: "#22c55e" }] : []),
  ].filter((s) => s.value > 0);

  const catList = c.categories.map((cat) => ({ id: cat.id, name: cat.name, icon: cat.icon }));

  return (
    <>
      {nav}
      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <h1 className="text-xl font-bold text-slate-900">{period.label} — spends</h1>

        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Available</div>
            <div className="mt-1 text-xl font-bold text-slate-800">{formatINR(available)}</div>
            <div className="text-[10px] text-slate-400">income − fixed</div>
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

        <PersonalSpendModal periodId={period.id} categories={catList} remaining={remaining} />

        {spends.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">By category</h2>
            <MoneyFlowDonut segments={segments} centerLabel="Spent" centerValue={formatINR(spentTotal)} />
          </div>
        )}

        <div className="space-y-3">
          {groups.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
              No spends yet this month. Tap <b>+ Add spend</b> above.
            </p>
          ) : (
            groups.map((g) => (
              <details key={g.cat!.id} open className="rounded-xl border border-slate-200 bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span className="font-medium text-slate-800">
                    {g.cat!.icon} {g.cat!.name}
                    <span className="ml-2 text-xs text-slate-400">({g.items.length})</span>
                  </span>
                  <span className="font-bold tabular-nums text-slate-700">{formatINR(g.total)}</span>
                </summary>
                <div className="divide-y divide-slate-100 border-t border-slate-100 px-4">
                  {g.items.map((s) => (
                    <div key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                      <div className="min-w-0">
                        <div className="truncate text-slate-700">{s.note || g.cat!.name}</div>
                        <div className="text-xs text-slate-400">
                          {new Date(s.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pl-2">
                        <span className="tabular-nums text-slate-700">{formatINR(s.amount)}</span>
                        <PersonalSpendRowActions periodId={period.id} categories={catList} initial={{ id: s.id, categoryId: s.categoryId, amount: s.amount, note: s.note }} />
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ))
          )}
        </div>

        {/* manage spend categories (lives here, not in Setup) */}
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
            <button className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900">Add</button>
          </form>
        </section>
      </main>
    </>
  );
}
