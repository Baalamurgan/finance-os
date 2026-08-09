import { formatINR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { loadPersonal } from "@/lib/loadPersonal";
import { personalMonthLabel } from "@/lib/personal";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { PersonalSpendFab } from "@/components/personal/PersonalSpendFab";
import { PersonalSpendsView } from "@/components/personal/PersonalSpendsView";
import { PersonalEmpty } from "@/components/personal/PersonalEmpty";
import { CardDuesStrip } from "@/components/personal/CardDuesStrip";
import { CardBillReminderBanner } from "@/components/personal/CardBillReminderBanner";
import { getPersonalCash, getCardDues, getPersonalLending } from "@/lib/personal/cash";
import { MoneyFlowDonut } from "@/components/Charts";
import { addPersonalCategory, archivePersonalCategory } from "@/app/personal/actions";

const COLORS = ["#059669", "#0ea5e9", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#ec4899", "#84cc16", "#6366f1", "#f97316"];

export default async function PersonalExpenses({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string; add?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const nav = <PersonalNav active="expenses" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} financeDue={c.cardReminders.length > 0} />;

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

  const [cash, cardDues, spends, lending] = await Promise.all([
    getPersonalCash(period),
    getCardDues(c.member.id),
    prisma.personalSpend.findMany({ where: { periodId: period.id }, orderBy: [{ date: "desc" }, { id: "desc" }] }),
    getPersonalLending(c.member.id),
  ]);
  const { personalExpense, netSpent, canSpend } = cash;
  const unpaidCardDues = cardDues.reduce((s, d) => s + d.unpaidTotal, 0);
  const owed = lending.owed;
  // Three honest figures (see the money model in lib/personal/cash.ts):
  //  canSpend    = budget headroom left this month. Splits already net out others' shares, so it's
  //                purely what YOU can still spend.
  //  inAccount   = actual cash in your bank RIGHT NOW. Card spends haven't left yet, so that money is
  //                still there (+ card dues); money you've lent out has left (− owed).
  //  afterSettle = what you keep once every card is paid AND every due/lend is collected. The card cash
  //                and the receivables both reverse out, so it lands exactly back on canSpend.
  const inAccount = canSpend + unpaidCardDues - owed;
  const afterSettle = canSpend;

  // The category donut reflects your NET spend (your share of splits) — the exact spend you did.
  const byCat = new Map<number, number>();
  for (const s of spends) byCat.set(s.categoryId, (byCat.get(s.categoryId) ?? 0) + (s.amount - (s.sharedOthers ?? 0)));
  const groups = [...byCat.entries()].map(([id, total]) => ({ cat: cats.get(id), total })).filter((g) => g.cat && g.total > 0).sort((a, b) => b.total - a.total);
  const segments = [
    ...groups.map((g, i) => ({ name: `${g.cat!.icon ?? ""} ${g.cat!.name}`.trim(), value: g.total, color: COLORS[i % COLORS.length] })),
    ...(canSpend > 0 ? [{ name: "Can spend", value: canSpend, color: "#22c55e" }] : []),
  ].filter((s) => s.value > 0);

  const spendsForClient = spends.map((s) => ({
    id: s.id,
    categoryId: s.categoryId,
    amount: s.amount,
    note: s.note,
    date: s.date.toISOString(),
    cardAccountId: s.cardAccountId,
  }));

  return (
    <>
      {nav}
      <main className="mx-auto max-w-3xl space-y-4 p-4 pb-28 sm:p-6">
        <h1 className="text-xl font-bold text-slate-900">{period.label} — spends</h1>

        {/* due-bill reminders (soon / overdue) */}
        <CardBillReminderBanner reminders={c.cardReminders} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* 1 — what you can still spend against this month's budget (Spent folded into the sub-line) */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">Can spend</div>
            <div className={`mt-1 text-xl font-bold ${canSpend >= 0 ? "text-emerald-800" : "text-red-600"}`}>{formatINR(canSpend)}</div>
            <div className="text-[10px] text-slate-500">of {formatINR(Math.max(0, personalExpense))} · spent {formatINR(netSpent)}</div>
          </div>
          {/* 2 — money actually in your account now: card cash hasn't left (+), lends have (−) */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">In account now</div>
            <div className={`mt-1 text-xl font-bold ${inAccount >= 0 ? "text-slate-800" : "text-red-600"}`}>{formatINR(inAccount)}</div>
            <div className="text-[10px] text-slate-400">
              {unpaidCardDues > 0 && <>{formatINR(unpaidCardDues)} held for cards</>}
              {unpaidCardDues > 0 && owed > 0 && " · "}
              {owed > 0 && <>{formatINR(owed)} out on loan</>}
              {unpaidCardDues === 0 && owed === 0 && "cash in hand"}
            </div>
          </div>
          {/* 3 — after paying every card and collecting every due/lend; nets back to your budget headroom */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">After settling</div>
            <div className={`mt-1 text-xl font-bold ${afterSettle >= 0 ? "text-slate-800" : "text-red-600"}`}>{formatINR(afterSettle)}</div>
            <div className="text-[10px] text-slate-400">cards paid · dues collected</div>
          </div>
        </div>

        {/* credit-card dues — deferred spends waiting for the bill */}
        <CardDuesStrip dues={cardDues} />

        {spends.length > 0 && segments.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">By category</h2>
            <MoneyFlowDonut segments={segments} centerLabel="Spent" centerValue={formatINR(netSpent)} />
          </div>
        )}

        <PersonalSpendsView spends={spendsForClient} categories={catList} cards={c.creditCards} periodId={period.id} />

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

      <PersonalSpendFab periodId={period.id} categories={catList} cards={c.creditCards} remaining={canSpend} autoOpen={sp.add === "1"} showButton={false} />
    </>
  );
}
