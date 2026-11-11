import { formatINR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { loadPersonal } from "@/lib/loadPersonal";
import { personalMonthLabel } from "@/lib/personal";
import { PlannedSpends } from "@/components/personal/PlannedSpends";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { PersonalSpendFab } from "@/components/personal/PersonalSpendFab";
import { PersonalSpendsView } from "@/components/personal/PersonalSpendsView";
import { InAccountCard } from "@/components/personal/InAccountCard";
import { PersonalEmpty } from "@/components/personal/PersonalEmpty";
import { CardDuesStrip } from "@/components/personal/CardDuesStrip";
import { CardBillReminderBanner } from "@/components/personal/CardBillReminderBanner";
import { getPersonalCash, getCardDues, getBalanceCards, getPersonalLending, getPersonalAccount } from "@/lib/personal/cash";
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
  const nav = <PersonalNav active="expenses" account={c.account} selYear={c.selYear} selMonth={c.selMonth} financeDue={c.cardReminders.length > 0} />;

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

  // Planned recurring spends (copied from Setup, not paid yet) — minus any removed from this month's plan.
  // All independent reads in one parallel round (the removed-from-plan filter is applied below in memory).
  const [removedSpends, pendingSpends, myAccounts, cash, cardDues, balanceCards, spends, lending, personalAcct] = await Promise.all([
    prisma.personalPlanStep.findMany({ where: { periodId: period.id, status: "skipped", templateKind: "spend" }, select: { templateId: true, label: true, amount: true } }),
    prisma.personalSpend.findMany({ where: { periodId: period.id, pending: true }, orderBy: [{ date: "asc" }, { id: "asc" }] }),
    prisma.financeAccount.findMany({ where: { memberId: c.member.id, active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, name: true, type: true } }),
    getPersonalCash(period),
    getCardDues(c.member.id),
    getBalanceCards(c.member.id),
    prisma.personalSpend.findMany({ where: { periodId: period.id, pending: false }, orderBy: [{ date: "desc" }, { id: "desc" }], include: { splitLoans: true } }),
    getPersonalLending(c.member.id),
    getPersonalAccount(c.member.id),
  ]);
  const removedSpendIds = removedSpends.map((r) => r.templateId as number);
  const removedList = removedSpends.map((r) => ({ id: r.templateId as number, label: r.label, amount: r.amount }));
  const removedSet = new Set(removedSpendIds);
  const planned = pendingSpends.filter((p) => !removedSet.has(p.id));
  const acctName = new Map(myAccounts.map((a) => [a.id, a.name]));
  const plannedItems = planned.map((p) => {
    const payId = p.cardAccountId ?? p.payAccountId;
    const cat = cats.get(p.categoryId);
    return { id: p.id, label: p.note?.trim() || cat?.name || "Spend", icon: cat?.icon ?? null, category: cat?.name ?? "Spend", amount: p.amount, day: p.date.getDate(), payId, payName: payId != null ? acctName.get(payId) ?? null : null };
  });
  const { personalExpense, netSpent, canSpend } = cash;
  const unpaidCardDues = cardDues.reduce((s, d) => s + d.unpaidTotal, 0);
  const owed = lending.owed;
  const borrowed = lending.borrowed;
  // Three honest figures (see the money model in lib/personal/cash.ts):
  //  canSpend    = budget headroom left this month. Splits already net out others' shares, so it's
  //                purely what YOU can still spend. (Lending/borrowing never touch this — not budget.)
  //  inAccount   = actual cash in your bank RIGHT NOW. Card spends haven't left yet, so that money is
  //                still there (+ card dues); money you've lent out has left (− owed); money you've
  //                borrowed is sitting in your account (+ borrowed) until you repay it.
  // Sheet + Spends + Lending only — nothing from the Money Plan: every Sheet bill already counts as spent
  // (it's out of Can spend), ticked or not. Card spends haven't left yet (+ dues); lent out (−); borrowed in (+).
  const calcInAccount = canSpend + unpaidCardDues - owed + borrowed;
  // "In account now" = the REAL balance of your personal account (e.g. Jupiter) when there is one; the
  // calculated figure stays as a check — a gap means something moved that isn't logged yet.
  const inAccount = personalAcct ? personalAcct.balance : calcInAccount;

  // The category donut reflects your NET spend (your share of splits) — the exact spend you did.
  const byCat = new Map<number, number>();
  for (const s of spends) byCat.set(s.categoryId, (byCat.get(s.categoryId) ?? 0) + (s.amount - (s.sharedOthers ?? 0)));
  const groups = [...byCat.entries()].map(([id, total]) => ({ cat: cats.get(id), total })).filter((g) => g.cat && g.total > 0).sort((a, b) => b.total - a.total);
  const segments = [
    ...groups.map((g, i) => ({ name: `${g.cat!.icon ?? ""} ${g.cat!.name}`.trim(), value: g.total, color: COLORS[i % COLORS.length] })),
    ...(canSpend > 0 ? [{ name: "Can spend", value: canSpend, color: "#22c55e" }] : []),
  ].filter((s) => s.value > 0);

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const spendsForClient = spends.map((s) => {
    // Split/reimbursement summary (Model A): start at YOUR share, assuming everyone pays. A
    // receivable that's deleted (they won't pay) is borne back onto your spend; received/settled
    // ones just drop off the count. `toCome` is what's still expected from the still-open people.
    let split: { kind: "split" | "reimburse"; youSpent: number; people: number; toCome: number; borne: number } | undefined;
    if (s.sharedOthers != null) {
      const myShare = r2(s.amount - s.sharedOthers);
      // Only the LENDER rows are this spend's receivables. A member split also writes a mirrored
      // "borrowed" row on the other member (same spendId) — that's their liability copy, not more owed
      // to you, so exclude it or the totals double.
      // Peer-card debt rows (cardAccountId set — the card OWNER's "lent" side carries this spendId too) are
      // what you owe the owner, not your split receivables — leave them out as well.
      const loans = s.splitLoans.filter((l) => l.direction === "lent" && l.cardAccountId == null);
      const existingTotal = r2(loans.reduce((t, l) => t + l.amount, 0));
      const borne = Math.max(0, r2(s.sharedOthers - existingTotal)); // receivables that were deleted → you eat them
      const open = loans.filter((l) => l.status === "open");
      const toCome = r2(open.reduce((t, l) => t + l.outstanding, 0));
      split = {
        kind: myShare <= 0.005 ? "reimburse" : "split",
        youSpent: r2(myShare + borne),
        people: open.length,
        toCome,
        borne,
      };
    }
    // What the EDIT modal needs to show/change the split: the current receivables (lent rows; peer-card
    // debt rows carry a cardAccountId and aren't part of it) and whether anything has moved on them yet
    // (paid back, settled or dropped) — then it's locked, same rule as the server (splitLockReason).
    let edit: { kind: "split" | "reimburse"; others: { name: string; amount: number; memberId: number | null }[]; myShare: number; reimbMemberId: number | null; reimbName: string | null; dueISO: string | null; notifyDaysBefore: number; locked: string | null } | undefined;
    if (s.sharedOthers != null) {
      const rows = s.splitLoans.filter((l) => l.cardAccountId == null);
      const lent = rows.filter((l) => l.direction === "lent");
      // a member counterparty = the member whose mirrored "borrowed" row shares this lent row's linkGroup
      const memberOf = (linkGroup: string | null) => (linkGroup ? rows.find((l) => l.direction === "borrowed" && l.linkGroup === linkGroup)?.memberId ?? null : null);
      const moved = rows.find((l) => l.status !== "open" || l.outstanding < l.amount - 0.005);
      const dropped = r2(lent.reduce((t, l) => t + l.amount, 0)) < s.sharedOthers - 0.005;
      const myShare = r2(s.amount - s.sharedOthers);
      const isReimb = myShare <= 0.005;
      edit = {
        kind: isReimb ? "reimburse" : "split",
        others: isReimb ? [] : lent.map((l) => ({ name: l.counterparty, amount: l.amount, memberId: memberOf(l.linkGroup) })),
        myShare,
        reimbMemberId: isReimb && lent[0] ? memberOf(lent[0].linkGroup) : null,
        reimbName: isReimb && lent[0] ? lent[0].counterparty : null,
        dueISO: lent[0]?.dueDate ? lent[0].dueDate.toISOString() : null,
        notifyDaysBefore: lent[0]?.notifyDaysBefore ?? 3,
        locked: moved ? "Part of this has already been paid back — undo that in Lending first to change it." : dropped ? "A share on this spend was dropped (you bore it) — the split can't be changed now." : null,
      };
    }
    return {
      id: s.id,
      categoryId: s.categoryId,
      amount: s.amount,
      note: s.note,
      date: s.date.toISOString(),
      cardAccountId: s.cardAccountId,
      split,
      edit,
    };
  });

  return (
    <>
      {nav}
      <main className="fo-rise mx-auto max-w-3xl space-y-4 p-4 pb-28 sm:p-6">
        <h1 className="text-xl font-bold text-slate-900">{period.label} — spends</h1>

        {/* due-bill reminders (soon / overdue) */}
        <CardBillReminderBanner reminders={c.cardReminders} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* 1 — what you can still spend against this month's budget (Spent folded into the sub-line) */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">Can spend</div>
            <div className={`mt-1 text-xl font-bold ${canSpend >= 0 ? "text-emerald-800" : "text-red-600"}`}>{formatINR(canSpend)}</div>
            <div className="text-[10px] text-slate-500">of {formatINR(Math.max(0, personalExpense))} · spent {formatINR(netSpent)}</div>
          </div>
          {/* 2 — money actually in your account now, tap to see what it's made of */}
          <InAccountCard
            accountName={personalAcct?.name ?? null}
            balance={personalAcct ? inAccount : null}
            canSpend={canSpend}
            cards={cardDues.filter((d) => d.unpaidTotal > 0.005).map((d) => ({ name: d.cardName, color: d.color, amount: d.unpaidTotal }))}
            lent={owed}
            toRepay={borrowed}
            toSend={personalAcct?.toSend ?? 0}
            toCome={personalAcct?.toCome ?? 0}
            otherName={personalAcct?.otherName ?? null}
          />
        </div>

        {/* all cards — credit bills (deferred spends) + debit/prepaid balances, with their spends */}
        <CardDuesStrip dues={cardDues} balances={balanceCards} />

        {spends.length > 0 && segments.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">By category</h2>
            <MoneyFlowDonut segments={segments} centerLabel="Spent" centerValue={formatINR(netSpent)} />
          </div>
        )}

        <PlannedSpends items={plannedItems} accounts={myAccounts} removed={removedList} />

        <PersonalSpendsView spends={spendsForClient} categories={catList} cards={c.spendCards} periodId={period.id} periodOpen={period.status === "open"} members={c.members} pastNames={c.pastNames} />

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

      <PersonalSpendFab periodId={period.id} categories={catList} cards={c.spendCards} members={c.members} pastNames={c.pastNames} remaining={canSpend} autoOpen={sp.add === "1"} showButton={false} />
    </>
  );
}
