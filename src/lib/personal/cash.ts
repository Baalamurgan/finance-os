import { prisma } from "@/lib/prisma";
import { currentCycle } from "@/lib/finance/cycle";
import { computeCreditDashboard } from "@/lib/finance/creditDashboard";

// Cash math for a personal month. Every spend counts AT SPEND TIME — a credit-card spend
// (or card fixed bill) reduces your spendable in the month you make it, exactly like cash,
// because you'll owe it either way. This is the SINGLE source of truth for "Remaining",
// used by the Sheet, Expenses, AND the carry-forward on rollover (ensurePersonalMonth).
//
// "Mark bill paid" no longer moves cash here (the spend was already counted) — it just
// settles the cycle (dropping it from unpaid dues) and records any cashback on the card.
// `remaining` is therefore the true after-cards figure; cash-in-hand = remaining + unpaid
// card dues (money still sitting in your account until you pay those bills).

export type PersonalCash = {
  totalIn: number; // income + carry-in + ad-hoc income
  fixedCash: number; // fixed Sheet lines paid from cash
  fixedCard: number; // fixed Sheet lines on a card (still a committed bill → counts)
  cashSpends: number; // daily spends paid from cash
  cardSpends: number; // daily spends on a card (counted at spend time)
  personalExpense: number; // totalIn − all fixed bills (the "can spend" number)
  spent: number; // cashSpends + cardSpends — all this month's spending
  remaining: number; // personalExpense − spent  (true, after cards)
};

export async function getPersonalCash(period: {
  id: number;
  income: number;
  carryForward: number;
}): Promise<PersonalCash> {
  const [fixedCashAgg, fixedCardAgg, cashSpendAgg, cardSpendAgg, extraAgg] = await Promise.all([
    prisma.personalExpense.aggregate({ where: { periodId: period.id, cardAccountId: null }, _sum: { amount: true } }),
    prisma.personalExpense.aggregate({ where: { periodId: period.id, cardAccountId: { not: null } }, _sum: { amount: true } }),
    prisma.personalSpend.aggregate({ where: { periodId: period.id, cardAccountId: null }, _sum: { amount: true } }),
    prisma.personalSpend.aggregate({ where: { periodId: period.id, cardAccountId: { not: null } }, _sum: { amount: true } }),
    prisma.personalIncome.aggregate({ where: { periodId: period.id }, _sum: { amount: true } }),
  ]);
  const fixedCash = fixedCashAgg._sum.amount ?? 0;
  const fixedCard = fixedCardAgg._sum.amount ?? 0;
  const cashSpends = cashSpendAgg._sum.amount ?? 0;
  const cardSpends = cardSpendAgg._sum.amount ?? 0;
  const totalIn = period.income + period.carryForward + (extraAgg._sum.amount ?? 0);
  const personalExpense = totalIn - fixedCash - fixedCard;
  const spent = cashSpends + cardSpends;
  return {
    totalIn,
    fixedCash,
    fixedCard,
    cashSpends,
    cardSpends,
    personalExpense,
    spent,
    remaining: personalExpense - spent,
  };
}

// The member's total unpaid credit-card obligation across ALL cycles (what you still owe
// on cards, regardless of month). Pairs with `remaining` to show true spendable-after-cards.
export async function getUnpaidCardDues(memberId: number): Promise<number> {
  const dues = await getCardDues(memberId);
  return dues.reduce((s, d) => s + d.unpaidTotal, 0);
}

// ── "On card, unpaid" — per credit card, the CC-tagged items grouped into billing cycles ──
export type CardDueItem = { label: string; amount: number; dateISO: string };
export type CardDueCycle = { cycleEndISO: string; dueISO: string | null; total: number; items: CardDueItem[] };
export type CardDue = {
  cardId: number;
  cardName: string;
  color: string;
  needsStatementDay: boolean; // true → can't derive cycles; prompt to set one
  unpaidTotal: number; // Σ across all unpaid cycles
  cycles: CardDueCycle[]; // unpaid, oldest first — each carries its line items
  ungrouped: CardDueItem[]; // items shown when no statement day (can't derive cycles)
  paid: { billId: number; cycleEndISO: string; amount: number }[]; // for undo
};

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export async function getCardDues(memberId: number): Promise<CardDue[]> {
  const cards = await prisma.financeAccount.findMany({
    where: { memberId, type: "credit_card" },
    include: { credit: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  if (cards.length === 0) return [];

  const [spends, fixed, bills, categories] = await Promise.all([
    prisma.personalSpend.findMany({ where: { memberId, cardAccountId: { not: null } }, select: { cardAccountId: true, amount: true, date: true, note: true, categoryId: true } }),
    prisma.personalExpense.findMany({ where: { memberId, cardAccountId: { not: null } }, select: { cardAccountId: true, amount: true, date: true, label: true } }),
    prisma.personalCardBill.findMany({ where: { memberId }, select: { id: true, cardAccountId: true, cycleEnd: true, amount: true } }),
    prisma.personalCategory.findMany({ where: { memberId }, select: { id: true, name: true } }),
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  // Normalise both spends and fixed lines to a common tagged-item shape with a display label.
  const items: { cardAccountId: number | null; amount: number; date: Date; label: string }[] = [
    ...spends.map((s) => ({ cardAccountId: s.cardAccountId, amount: s.amount, date: s.date, label: s.note?.trim() || catName.get(s.categoryId) || "Spend" })),
    ...fixed.map((e) => ({ cardAccountId: e.cardAccountId, amount: e.amount, date: e.date, label: e.label?.trim() || "Fixed bill" })),
  ];
  const out: CardDue[] = [];

  for (const card of cards) {
    const statementDay = card.credit?.statementDay ?? null;
    const dueOffset = card.credit?.dueOffsetDays ?? null;
    const mine = items.filter((it) => it.cardAccountId === card.id);
    const myBills = bills.filter((b) => b.cardAccountId === card.id);
    const unpaidTotalAll = mine.reduce((s, it) => s + it.amount, 0);
    if (mine.length === 0 && myBills.length === 0) continue; // nothing tagged, ever

    const toItem = (it: (typeof mine)[number]): CardDueItem => ({ label: it.label, amount: it.amount, dateISO: it.date.toISOString() });
    const byDateDesc = (a: CardDueItem, b: CardDueItem) => b.dateISO.localeCompare(a.dateISO);

    if (statementDay == null) {
      // Can't derive cycles without a statement day — show the total, the items, and prompt to configure.
      out.push({ cardId: card.id, cardName: card.name, color: card.color, needsStatementDay: true, unpaidTotal: unpaidTotalAll, cycles: [], ungrouped: mine.map(toItem).sort(byDateDesc), paid: [] });
      continue;
    }

    // Group tagged items into billing cycles by their date; a cycle with a matching
    // PersonalCardBill is settled (its cash already left) and drops off the unpaid list.
    const paidKeys = new Set(myBills.map((b) => midnight(b.cycleEnd).getTime()));
    const byCycle = new Map<number, { end: Date; due: Date | null; total: number; items: CardDueItem[] }>();
    for (const it of mine) {
      const cyc = currentCycle(statementDay, it.date, dueOffset);
      const key = midnight(cyc.end).getTime();
      const g = byCycle.get(key) ?? { end: midnight(cyc.end), due: cyc.dueDate, total: 0, items: [] };
      g.total += it.amount;
      g.items.push(toItem(it));
      byCycle.set(key, g);
    }
    const cycles = [...byCycle.entries()]
      .filter(([key]) => !paidKeys.has(key))
      .sort((a, b) => a[0] - b[0])
      .map(([, g]) => ({ cycleEndISO: g.end.toISOString(), dueISO: g.due ? g.due.toISOString() : null, total: g.total, items: g.items.sort(byDateDesc) }));
    const unpaidTotal = cycles.reduce((s, c) => s + c.total, 0);

    out.push({
      cardId: card.id,
      cardName: card.name,
      color: card.color,
      needsStatementDay: false,
      unpaidTotal,
      cycles,
      ungrouped: [],
      paid: myBills.map((b) => ({ billId: b.id, cycleEndISO: midnight(b.cycleEnd).toISOString(), amount: b.amount })),
    });
  }
  return out;
}

// ── Due-bill reminders (P3): a card's soonest unpaid cycle that's due within the window
// (or overdue), with BOTH the in-app tagged total and the card-ledger outstanding. ──────
export const CARD_REMINDER_WINDOW_DAYS = 5;

export type CardReminder = {
  cardId: number;
  cardName: string;
  color: string;
  dueISO: string;
  daysUntilDue: number; // negative = overdue
  overdue: boolean;
  taggedTotal: number; // in-app CC-tagged spends for that cycle
  ledgerOutstanding: number; // from the card's own AccountTransaction ledger (0 if unmaintained)
};

export async function getCardBillReminders(memberId: number, now = new Date()): Promise<CardReminder[]> {
  const dues = await getCardDues(memberId);
  const soon = dues.filter((d) => !d.needsStatementDay && d.cycles.some((c) => c.dueISO));
  if (soon.length === 0) return [];

  const cards = await prisma.financeAccount.findMany({
    where: { memberId, type: "credit_card" },
    include: { credit: true, txns: true },
  });
  const today = midnight(now);
  const out: CardReminder[] = [];

  for (const due of soon) {
    // the earliest-due unpaid cycle
    const withDue = due.cycles.filter((c) => c.dueISO) as { cycleEndISO: string; dueISO: string; total: number }[];
    const next = withDue.reduce((a, b) => (a.dueISO < b.dueISO ? a : b));
    const dueDate = midnight(new Date(next.dueISO));
    const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / 86400000);
    if (daysUntilDue > CARD_REMINDER_WINDOW_DAYS) continue; // not near enough yet

    const card = cards.find((c) => c.id === due.cardId);
    const ledgerOutstanding = card
      ? Math.max(0, computeCreditDashboard({
          creditLimit: card.credit?.creditLimit,
          statementDay: card.credit?.statementDay,
          dueOffsetDays: card.credit?.dueOffsetDays,
          txns: card.txns,
          now,
        }).outstanding)
      : 0;

    out.push({
      cardId: due.cardId,
      cardName: due.cardName,
      color: due.color,
      dueISO: next.dueISO,
      daysUntilDue,
      overdue: daysUntilDue < 0,
      taggedTotal: next.total,
      ledgerOutstanding,
    });
  }
  return out.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}
