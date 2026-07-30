import { formatINR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { loadPersonal } from "@/lib/loadPersonal";
import { personalMonthLabel, personalCycleRange } from "@/lib/personal";
import { getPersonalCash, getUnpaidCardDues, getPersonalLending } from "@/lib/personal/cash";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { PersonalFixedModal } from "@/components/personal/PersonalFixedModal";
import { PersonalFixedRowActions } from "@/components/personal/PersonalFixedRowActions";
import { PersonalSpendFab } from "@/components/personal/PersonalSpendFab";
import { PersonalEmpty } from "@/components/personal/PersonalEmpty";
import { CardBillReminderBanner } from "@/components/personal/CardBillReminderBanner";
import { MoneyFlowDonut } from "@/components/Charts";
import { setPersonalIncome, addPersonalIncome, deletePersonalIncome, createPersonalPreview, rebuildPersonalPreviewAction, discardPersonalPreview } from "@/app/personal/actions";

const COLORS = ["#0ea5e9", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#ec4899", "#84cc16", "#6366f1", "#f97316", "#06b6d4"];

export default async function PersonalSheet({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const nav = <PersonalNav active="sheet" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} financeDue={c.cardReminders.length > 0} />;

  if (!c.selected) {
    return (
      <>
        {nav}
        <PersonalEmpty label={personalMonthLabel(c.selMonth, c.selYear)} />
      </>
    );
  }

  const period = c.selected;
  const isDraft = period.status === "draft";
  const cats = new Map(c.categories.map((cat) => [cat.id, cat]));
  const catList = c.categories.map((cat) => ({ id: cat.id, name: cat.name, icon: cat.icon }));
  const cardMap = new Map(c.creditCards.map((cc) => [cc.id, cc]));

  const [expenses, extraIncomes, cash, unpaidCardDues, lending] = await Promise.all([
    prisma.personalExpense.findMany({ where: { periodId: period.id }, orderBy: { amount: "desc" } }),
    prisma.personalIncome.findMany({ where: { periodId: period.id }, orderBy: { id: "desc" } }),
    getPersonalCash(period),
    getUnpaidCardDues(c.member.id),
    getPersonalLending(c.member.id),
  ]);
  const monthlyExpenses = expenses.reduce((s, e) => s + e.amount, 0); // all fixed lines (display subtotal)
  // Every spend counts at spend time. Three figures (see the money model):
  //  Can spend  = personalExpense − your NET spend (splits net out others' shares)
  //  In hand    = can spend + card dues − money owed to you (physical cash you hold)
  //  Spent      = net spend (your share only)
  const { totalIn, personalExpense, netSpent, canSpend } = cash;
  const owed = lending.owed;
  const inHand = canSpend + unpaidCardDues - owed;
  const spentPct = personalExpense > 0 ? Math.min(100, (netSpent / personalExpense) * 100) : 0;

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
        <CardBillReminderBanner reminders={c.cardReminders} />

        {/* next-month preview draft */}
        {isDraft && (
          <div className="rounded-xl border-2 border-dashed border-violet-300 bg-violet-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg">🔮</span>
                  <h2 className="font-bold text-violet-800">Next-month preview — {period.label}</h2>
                  <span className="rounded-full bg-violet-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">Draft</span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-violet-700/80">
                  Plan ahead — edit next month&apos;s salary, add predicted spends &amp; fixed lines. Estimated remaining
                  seeds from this month&apos;s leftover. It becomes the live month automatically when {period.label} starts.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a href="/personal/sheet" className="rounded-md border border-violet-300 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100">← Back to now</a>
                <form action={rebuildPersonalPreviewAction}>
                  <input type="hidden" name="periodId" value={period.id} />
                  <button className="rounded-md border border-violet-300 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100">↻ Rebuild</button>
                </form>
                <form action={discardPersonalPreview}>
                  <input type="hidden" name="periodId" value={period.id} />
                  <button className="rounded-md px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">Discard</button>
                </form>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{period.label}</h1>
            {personalCycleRange(period.year, period.month, c.member.personalWindDownDay) && (
              <p className="text-xs text-slate-400">{personalCycleRange(period.year, period.month, c.member.personalWindDownDay)} · your cycle</p>
            )}
          </div>
          {period.status === "open" && (
            <form action={createPersonalPreview}>
              <button className="rounded-full border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100">🔮 Preview next month →</button>
            </form>
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
          {/* Can spend = the headline: what's left of your month's budget (X of Y) */}
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-slate-700">Can spend</span>
            <span className="text-sm tabular-nums text-slate-400">
              <b className={`text-lg ${canSpend < 0 ? "text-red-600" : "text-emerald-700"}`}>{formatINR(canSpend)}</b> of {formatINR(Math.max(0, personalExpense))}
            </span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${netSpent > personalExpense ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${spentPct}%` }} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 border-t border-slate-100 pt-2 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-400">In hand</div>
              <div className={`font-bold tabular-nums ${inHand < 0 ? "text-red-600" : "text-slate-800"}`}>{formatINR(inHand)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Spent (your share)</div>
              <div className="font-bold tabular-nums text-slate-800">{formatINR(netSpent)}</div>
            </div>
          </div>
          {(unpaidCardDues > 0 || owed > 0) && (
            <div className="mt-1.5 text-[11px] text-slate-400">
              {unpaidCardDues > 0 && <>{formatINR(unpaidCardDues)} owed on cards</>}
              {unpaidCardDues > 0 && owed > 0 && " · "}
              {owed > 0 && <>{formatINR(owed)} owed to you (lent)</>}
            </div>
          )}
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
                    {g.items.map((e) => {
                      const card = e.cardAccountId != null ? cardMap.get(e.cardAccountId) : undefined;
                      return (
                      <div key={e.id} className="flex items-center justify-between py-2 text-sm">
                        <span className="flex items-center gap-1.5 text-slate-700">
                          {e.label}
                          {!e.recurring && <span className="text-[10px] text-slate-400">(one-off)</span>}
                          {card && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500" title={`On ${card.name} — counts now; pay the cash at the card's bill`}>
                              <span className="h-1.5 w-1.5 rounded-full" style={{ background: card.color }} />💳
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className={`tabular-nums ${card ? "text-slate-400" : "text-slate-700"}`}>{formatINR(e.amount)}</span>
                          <PersonalFixedRowActions periodId={period.id} categories={catList} cards={c.creditCards} initial={{ id: e.id, label: e.label, categoryId: e.categoryId, amount: e.amount, recurring: e.recurring, cardAccountId: e.cardAccountId }} />
                        </span>
                      </div>
                      );
                    })}
                  </div>
                </details>
              ))
            )}
            <div className="px-2 py-2">
              <PersonalFixedModal periodId={period.id} categories={catList} cards={c.creditCards} defaultRecurring={false} />
            </div>
          </div>
        </details>

        <p className="text-center text-xs text-slate-400">Daily spends live in the <b>Expenses</b> tab and draw down your personal expense.</p>
      </main>

      <PersonalSpendFab periodId={period.id} categories={catList} cards={c.creditCards} remaining={canSpend} showButton={false} />
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
