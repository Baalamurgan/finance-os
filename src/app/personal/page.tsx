import { formatINR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { loadPersonal } from "@/lib/loadPersonal";
import { personalMonthLabel } from "@/lib/personal";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { PersonalExpenseModal } from "@/components/personal/PersonalExpenseModal";
import { PersonalExpenseRowActions } from "@/components/personal/PersonalExpenseRowActions";
import { MoneyFlowDonut } from "@/components/Charts";
import { setPersonalIncome } from "@/app/personal/actions";

const COLORS = ["#059669", "#0ea5e9", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#ec4899", "#84cc16", "#6366f1", "#f97316"];

export default async function PersonalSheet({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);

  const nav = (
    <PersonalNav active="sheet" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} />
  );

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
  const expenses = await prisma.personalExpense.findMany({
    where: { periodId: period.id },
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });

  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0);
  const balance = period.income - totalExpense;

  // group by category (subtotal desc)
  const byCat = new Map<number, { total: number; items: typeof expenses }>();
  for (const e of expenses) {
    const g = byCat.get(e.categoryId) ?? { total: 0, items: [] };
    g.total += e.amount;
    g.items.push(e);
    byCat.set(e.categoryId, g);
  }
  const groups = [...byCat.entries()]
    .map(([catId, g]) => ({ cat: cats.get(catId), ...g }))
    .filter((g) => g.cat)
    .sort((a, b) => b.total - a.total);

  const segments = [
    ...groups.map((g, i) => ({
      name: `${g.cat!.icon ?? ""} ${g.cat!.name}`.trim(),
      value: g.total,
      color: COLORS[i % COLORS.length],
    })),
    ...(balance > 0 ? [{ name: "Left over", value: balance, color: "#22c55e" }] : []),
  ].filter((s) => s.value > 0);

  const catList = c.categories.map((cat) => ({ id: cat.id, name: cat.name, icon: cat.icon }));

  return (
    <>
      {nav}
      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <h1 className="text-xl font-bold text-slate-900">{period.label}</h1>

        {/* income + balance */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <form action={setPersonalIncome} className="rounded-xl border border-emerald-200 bg-white p-4">
            <input type="hidden" name="periodId" value={period.id} />
            <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-600">Income</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-slate-400">₹</span>
              <input
                name="income"
                type="number"
                step="0.01"
                defaultValue={period.income}
                className="w-full rounded-md border border-slate-200 px-2 py-1 text-xl font-bold tabular-nums outline-none focus:border-emerald-400"
              />
              <button className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">
                Save
              </button>
            </div>
          </form>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Spent</div>
            <div className="mt-1 text-2xl font-bold text-slate-800">{formatINR(totalExpense)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Left</div>
            <div className={`mt-1 text-2xl font-bold ${balance >= 0 ? "text-emerald-700" : "text-red-600"}`}>
              {formatINR(balance)}
            </div>
          </div>
        </div>

        {/* where it went */}
        {period.income > 0 && segments.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-800">Where the money went</h2>
            <p className="mb-4 text-xs text-slate-500">{formatINR(period.income)} income this month.</p>
            <MoneyFlowDonut segments={segments} centerLabel="Income" centerValue={formatINR(period.income)} />
          </div>
        )}

        {/* add expense */}
        <PersonalExpenseModal periodId={period.id} categories={catList} />

        {/* expenses by category */}
        <div className="space-y-3">
          {groups.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
              No expenses yet this month. Add your first one above.
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
                  {g.items.map((e) => (
                    <div key={e.id} className="flex items-center justify-between py-2.5 text-sm">
                      <div className="min-w-0">
                        <div className="truncate text-slate-700">{e.note || g.cat!.name}</div>
                        <div className="text-xs text-slate-400">
                          {new Date(e.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                          {e.recurring ? " · repeats" : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pl-2">
                        <span className="tabular-nums text-slate-700">{formatINR(e.amount)}</span>
                        <PersonalExpenseRowActions
                          periodId={period.id}
                          categories={catList}
                          initial={{ id: e.id, categoryId: e.categoryId, amount: e.amount, note: e.note, recurring: e.recurring }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ))
          )}
        </div>
      </main>
    </>
  );
}
