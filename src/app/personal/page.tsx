import { formatINR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { loadPersonal } from "@/lib/loadPersonal";
import { personalMonthLabel } from "@/lib/personal";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { PersonalFixedModal } from "@/components/personal/PersonalFixedModal";
import { PersonalFixedRowActions } from "@/components/personal/PersonalFixedRowActions";
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
  const [fixed, spends] = await Promise.all([
    prisma.personalExpense.findMany({ where: { periodId: period.id }, orderBy: { amount: "desc" } }),
    prisma.personalSpend.aggregate({ where: { periodId: period.id }, _sum: { amount: true } }),
  ]);
  const fixedTotal = fixed.reduce((s, e) => s + e.amount, 0);
  const spendsTotal = spends._sum.amount ?? 0;
  const out = fixedTotal + spendsTotal;
  const left = period.income - out;

  const segments = [
    ...fixed.map((e, i) => ({ name: e.label, value: e.amount, color: COLORS[i % COLORS.length] })),
    ...(spendsTotal > 0 ? [{ name: "Spends", value: spendsTotal, color: "#3f6152" }] : []),
    ...(left > 0 ? [{ name: "Left over", value: left, color: "#22c55e" }] : []),
  ].filter((s) => s.value > 0);

  return (
    <>
      {nav}
      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <h1 className="text-xl font-bold text-slate-900">{period.label}</h1>

        <div className="grid grid-cols-3 gap-4">
          <form action={setPersonalIncome} className="rounded-xl border border-emerald-200 bg-white p-4">
            <input type="hidden" name="periodId" value={period.id} />
            <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-600">Income</div>
            <div className="mt-1 flex items-center gap-1">
              <span className="text-slate-400">₹</span>
              <input name="income" type="number" step="0.01" defaultValue={period.income} className="w-full min-w-0 rounded-md border border-slate-200 px-2 py-1 text-lg font-bold tabular-nums outline-none focus:border-emerald-400" />
              <button className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700">Save</button>
            </div>
          </form>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Out (fixed + spends)</div>
            <div className="mt-1 text-2xl font-bold text-slate-800">{formatINR(out)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Left</div>
            <div className={`mt-1 text-2xl font-bold ${left >= 0 ? "text-emerald-700" : "text-red-600"}`}>{formatINR(left)}</div>
          </div>
        </div>

        {period.income > 0 && segments.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-800">Where the income went</h2>
            <p className="mb-4 text-xs text-slate-500">{formatINR(period.income)} income · fixed bills, spends and what&apos;s left.</p>
            <MoneyFlowDonut segments={segments} centerLabel="Income" centerValue={formatINR(period.income)} />
          </div>
        )}

        {/* fixed monthly expenses */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">Fixed monthly expenses</h2>
            <span className="text-sm font-bold tabular-nums text-slate-700">{formatINR(fixedTotal)}</span>
          </div>
          <div className="divide-y divide-slate-100 px-4">
            {fixed.length === 0 ? (
              <p className="py-3 text-sm text-slate-400">None yet — add rent, subscriptions, EMIs…</p>
            ) : (
              fixed.map((e) => (
                <div key={e.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="text-slate-700">
                    {e.label}
                    {e.recurring ? "" : <span className="ml-2 text-[10px] text-slate-400">(this month only)</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-slate-700">{formatINR(e.amount)}</span>
                    <PersonalFixedRowActions periodId={period.id} initial={{ id: e.id, label: e.label, amount: e.amount, recurring: e.recurring }} />
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="px-4 py-3">
            <PersonalFixedModal periodId={period.id} />
          </div>
        </section>

        <p className="text-center text-xs text-slate-400">
          Track daily spends in the <b>Expenses</b> tab — they draw down what&apos;s left.
        </p>
      </main>
    </>
  );
}
