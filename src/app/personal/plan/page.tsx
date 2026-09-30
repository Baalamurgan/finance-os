import Link from "next/link";
import { formatINR } from "@/lib/format";
import { loadPersonal } from "@/lib/loadPersonal";
import { prisma } from "@/lib/prisma";
import { getWalletAccounts } from "@/lib/finance/queries";
import { getCardDues, getPersonalCash } from "@/lib/personal/cash";
import { getPersonalSavings } from "@/lib/personal/savings";
import { buildRecurringMoves } from "@/lib/personal/plan";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { TransferModal } from "@/components/personal/TransferModal";
import { RecurringMoves } from "@/components/personal/RecurringMoves";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";

// Personal Money Plan: the single place a member sees where their money IS (balance accounts) and the
// moves to make this month — card bills due, people they owe, and transfers between their own accounts.
// Read-derived: paying via the existing card/lending flows drops items off automatically, so there's no
// separate "done" state to keep in sync. The only write here is recording a transfer (TransferModal).
export default async function PersonalPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const financeDue = c.cardReminders.length > 0;
  const nav = (
    <PersonalNav active="plan" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} financeDue={financeDue} />
  );

  if (!c.selected) {
    return (
      <>
        {nav}
        <main className="mx-auto max-w-3xl p-10 text-center text-sm text-slate-500">
          Start a month first to see your money plan.
        </main>
      </>
    );
  }

  // This month's calendar bounds — used to tell whether a repeating move has already been done.
  const monthStart = new Date(Date.UTC(c.selected.year, c.selected.month - 1, 1));
  const monthEnd = new Date(Date.UTC(c.selected.year, c.selected.month, 1));

  const [wallet, dues, cash, savings, bills, owed, transfers, planItems, monthTransfersOut, monthSavings] = await Promise.all([
    getWalletAccounts(c.member.id),
    getCardDues(c.member.id),
    getPersonalCash({ id: c.selected.id, income: c.selected.income, carryForward: c.selected.carryForward }),
    getPersonalSavings(c.member.id),
    prisma.personalExpense.findMany({ where: { periodId: c.selected.id }, select: { amount: true, cardAccountId: true } }),
    prisma.personalLoan.findMany({
      where: { memberId: c.member.id, direction: "borrowed", status: "open" },
      select: { id: true, counterparty: true, outstanding: true },
      orderBy: { outstanding: "desc" },
    }),
    prisma.accountTransaction.findMany({
      where: { memberId: c.member.id, type: "transfer_out" },
      orderBy: { date: "desc" },
      take: 6,
      include: { account: { select: { name: true, color: true } } },
    }),
    prisma.personalPlanItem.findMany({
      where: { memberId: c.member.id, active: true },
      select: { id: true, kind: true, label: true, amount: true, dayOfMonth: true, fromAccountId: true, toAccountId: true, note: true, sortOrder: true },
    }),
    prisma.accountTransaction.findMany({
      where: { memberId: c.member.id, type: "transfer_out", date: { gte: monthStart, lt: monthEnd } },
      select: { accountId: true, amount: true },
    }),
    prisma.personalSavings.findMany({
      where: { memberId: c.member.id, amount: { gt: 0 }, createdAt: { gte: monthStart, lt: monthEnd } },
      select: { amount: true },
    }),
  ]);

  // Money you HAVE: balance accounts (bank / debit / prepaid).
  const balAccts = wallet
    .filter((w) => w.balance != null)
    .map((w) => ({ id: w.account.id, name: w.account.name, color: w.account.color, balance: w.balance ?? 0 }));
  const totalInAccounts = balAccts.reduce((s, a) => s + a.balance, 0);

  // Recurring moves (the maintainable template) → this month's steps with a done flag.
  const accountNameById = new Map(wallet.map((w) => [w.account.id, w.account.name]));
  const recurringMoves = buildRecurringMoves(
    planItems,
    monthTransfersOut,
    monthSavings,
    (id) => (id == null ? null : accountNameById.get(id) ?? null),
  );

  // Card bills still to pay (your personal dues + any family/peer spends the card fronts), soonest first.
  const cardBills = dues
    .map((d) => ({
      cardId: d.cardId,
      cardName: d.cardName,
      toPay: d.unpaidTotal + d.familyUnpaidTotal,
      dueISO: d.cycles[0]?.dueISO ?? null,
      needsSetup: d.needsStatementDay,
    }))
    .filter((d) => d.toPay > 0.005)
    .sort((a, b) => (a.dueISO ?? "9").localeCompare(b.dueISO ?? "9"));
  const cardBillTotal = cardBills.reduce((s, d) => s + d.toPay, 0);

  // People you owe (borrowed, still open).
  const owedTotal = owed.reduce((s, l) => s + l.outstanding, 0);

  // Fixed-bill context. Card-paid bills are already inside the card bills above, so only cash bills
  // are "extra" outflow — shown as context, not double-counted in the coverage figure.
  const cashBills = bills.filter((b) => b.cardAccountId == null).reduce((s, b) => s + b.amount, 0);
  const cardPaidBills = bills.filter((b) => b.cardAccountId != null).reduce((s, b) => s + b.amount, 0);

  const stillToPay = cardBillTotal + owedTotal; // status-tracked, clearly-outstanding moves
  const coverage = totalInAccounts - stillToPay;

  return (
    <>
      {nav}
      <main className="mx-auto max-w-3xl space-y-5 p-4 pb-24 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Money plan — {c.selected.label}</h1>
          <p className="text-sm text-slate-500">Where your money is, and the moves to make this month.</p>
        </div>

        {/* In your accounts (stock) + transfer tool */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">In your accounts</div>
              <div className="text-2xl font-bold tabular-nums text-slate-900">{formatINR(totalInAccounts)}</div>
            </div>
            <TransferModal accounts={balAccts} />
          </div>
          {balAccts.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {balAccts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
                    <span className="truncate text-slate-600">{a.name}</span>
                  </span>
                  <span className="tabular-nums font-medium text-slate-800">{formatINR(a.balance)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">
              No bank accounts yet.{" "}
              <Link href="/personal/cards" className="font-medium text-emerald-700 underline">Add your accounts</Link>{" "}
              to plan transfers between them.
            </p>
          )}
        </section>

        {/* Repeating moves (the maintainable monthly plan) */}
        <RecurringMoves moves={recurringMoves} accounts={balAccts} />

        {/* Still to pay this month (flow) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Still to pay this month</h2>
          {cardBills.length > 0 || owed.length > 0 ? (
            <ul className="space-y-2">
              {cardBills.map((d) => (
                <li key={`c${d.cardId}`}>
                  <Link href={`/personal/finance/${d.cardId}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-3 hover:bg-slate-50">
                    <span className="flex min-w-0 items-center gap-2">
                      <span>💳</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">{d.cardName} bill</span>
                        <span className="block text-[11px] text-slate-400">
                          {d.needsSetup ? "set a statement day" : d.dueISO ? `due ${fmtDate(d.dueISO)}` : "due date not set"}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums font-semibold text-red-600">{formatINR(d.toPay)}</span>
                  </Link>
                </li>
              ))}
              {owed.map((l) => (
                <li key={`l${l.id}`}>
                  <Link href="/personal/loans" className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-3 hover:bg-slate-50">
                    <span className="flex min-w-0 items-center gap-2">
                      <span>🤝</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">Repay {l.counterparty}</span>
                        <span className="block text-[11px] text-slate-400">you borrowed this</span>
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums font-semibold text-red-600">{formatINR(l.outstanding)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">Nothing outstanding right now. 🎉</p>
          )}

          {balAccts.length > 0 && stillToPay > 0 && (
            <div className={`mt-3 rounded-lg p-3 text-sm ${coverage >= 0 ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
              Your accounts hold <b>{formatINR(totalInAccounts)}</b> · still to pay <b>{formatINR(stillToPay)}</b> →{" "}
              {coverage >= 0 ? <>covered, <b>{formatINR(coverage)}</b> spare.</> : <>short by <b>{formatINR(-coverage)}</b> — move or top up.</>}
            </div>
          )}
        </section>

        {/* This month at a glance (context) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">This month at a glance</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Money in" value={cash.totalIn} />
            <Stat label="Fixed bills" value={cash.fixedCash + cash.fixedCard} />
            <Stat label="Left to spend" value={cash.canSpend} tone={cash.canSpend >= 0 ? "ok" : "bad"} />
            <Stat label="Savings pot" value={savings.balance} />
          </dl>
          {cardPaidBills > 0 && (
            <p className="mt-3 text-[11px] text-slate-400">
              Of your fixed bills, {formatINR(cashBills)} is paid from cash/bank and {formatINR(cardPaidBills)} rides on cards (in the card bills above).
            </p>
          )}
        </section>

        {/* Recent transfers */}
        {transfers.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Recent transfers</h2>
            <ul className="space-y-1.5">
              {transfers.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.account.color }} />
                    <span className="truncate text-slate-600">{t.merchant}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="tabular-nums font-medium text-slate-800">{formatINR(t.amount)}</span>
                    <span className="ml-2 text-[11px] text-slate-400">{fmtDate(t.date.toISOString())}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "bad" }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`text-base font-bold tabular-nums ${tone === "bad" ? "text-red-600" : tone === "ok" ? "text-emerald-700" : "text-slate-800"}`}>
        {formatINR(value)}
      </dd>
    </div>
  );
}
