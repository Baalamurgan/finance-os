import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { currentCycle } from "@/lib/finance/cycle";
import { computeCreditDashboard } from "@/lib/finance/creditDashboard";
import { computeBalance } from "@/lib/finance/balance";
import { REMOVED_NOTE } from "@/lib/notes";

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
  totalIn: number; // income + carry-in + ad-hoc income (a REMOVED income step is left out)
  fixedCash: number; // fixed Sheet lines paid from cash — ALL planned bills, paid or not
  fixedCard: number; // fixed Sheet lines on a card (still a committed bill → counts)
  cashSpends: number; // daily spends paid from cash
  cardSpends: number; // daily spends on a card (counted at spend time)
  personalExpense: number; // totalIn − all fixed bills (the month's total to spend = "Y")
  grossSpent: number; // cashSpends + cardSpends — total money paid out as spends
  netSpent: number; // grossSpent − others' shares of splits — what YOU actually consumed
  plannedUnpaid: number; // planned bills not yet paid (already out of Can-spend, still sitting in your account)
  canSpend: number; // personalExpense − netSpent (the headline "left to spend")
};

// The Money Plan's BILLS are the budget: every planned bill copied from Setup counts from day one, so
// "Can spend" is what's left after them; ticking a bill PAID only moves the real account balance. A recurring
// SPEND is just a spend: it reduces Can-spend when its step is marked done, like any other spend. A step
// REMOVED for the month (status "skipped") leaves the budget — the Setup template is untouched and the item
// returns next month.
export async function getPersonalCash(period: {
  id: number;
  income: number;
  carryForward: number;
}): Promise<PersonalCash> {
  const removed = await prisma.personalPlanStep.findMany({
    where: { periodId: period.id, status: "skipped", templateKind: { in: ["income", "expense"] }, templateId: { not: null } },
    select: { templateKind: true, templateId: true },
  });
  const ids = (k: string) => {
    const a = removed.filter((r) => r.templateKind === k).map((r) => r.templateId as number);
    return a.length ? a : [0];
  };
  const [fixedCashAgg, fixedCardAgg, cashSpendAgg, cardSpendAgg, extraAgg, sharedOthersAgg, pendingFixedAgg] = await Promise.all([
    prisma.personalExpense.aggregate({ where: { periodId: period.id, cardAccountId: null, id: { notIn: ids("expense") } }, _sum: { amount: true } }),
    prisma.personalExpense.aggregate({ where: { periodId: period.id, cardAccountId: { not: null }, id: { notIn: ids("expense") } }, _sum: { amount: true } }),
    // pending recurring spends haven't happened yet — they count once their step is marked done.
    prisma.personalSpend.aggregate({ where: { periodId: period.id, cardAccountId: null, pending: false }, _sum: { amount: true } }),
    prisma.personalSpend.aggregate({ where: { periodId: period.id, cardAccountId: { not: null }, pending: false }, _sum: { amount: true } }),
    prisma.personalIncome.aggregate({ where: { periodId: period.id, id: { notIn: ids("income") } }, _sum: { amount: true } }),
    prisma.personalSpend.aggregate({ where: { periodId: period.id, pending: false }, _sum: { sharedOthers: true } }),
    prisma.personalExpense.aggregate({ where: { periodId: period.id, pending: true, id: { notIn: ids("expense") } }, _sum: { amount: true } }),
  ]);
  const fixedCash = fixedCashAgg._sum.amount ?? 0;
  const fixedCard = fixedCardAgg._sum.amount ?? 0;
  const cashSpends = cashSpendAgg._sum.amount ?? 0;
  const cardSpends = cardSpendAgg._sum.amount ?? 0;
  const sharedOthers = sharedOthersAgg._sum.sharedOthers ?? 0;
  const plannedUnpaid = pendingFixedAgg._sum.amount ?? 0;
  const totalIn = period.income + period.carryForward + (extraAgg._sum.amount ?? 0);
  const personalExpense = totalIn - fixedCash - fixedCard;
  const grossSpent = cashSpends + cardSpends;
  const netSpent = grossSpent - sharedOthers;
  return {
    totalIn,
    fixedCash,
    fixedCard,
    cashSpends,
    cardSpends,
    personalExpense,
    grossSpent,
    netSpent,
    plannedUnpaid,
    canSpend: personalExpense - netSpent,
  };
}

// Lending that moves the member's ACTUAL cash:
//  • owed     = open "lent" loans (manual lends + shared-spend receivables) — cash that's left your hand.
//  • borrowed = every open "borrowed" debt — cash someone lent you AND a spend on someone else's card. The
//    card one counts too: it's in your Can spend, but no money left your account until you repay them, so
//    that cash is still with you (e.g. ID card protector on Harish's Amazon Pay → +₹324 until you pay him).
// Drives cash-in-hand: canSpend + unpaid card dues − owed + borrowed. Neither touches "Can spend"
// (lending/borrowing isn't budget) — they only move "In account".
export async function getPersonalLending(memberId: number): Promise<{ owed: number; borrowed: number }> {
  const [lentAgg, borrowedAgg] = await Promise.all([
    prisma.personalLoan.aggregate({ where: { memberId, direction: "lent", status: "open" }, _sum: { outstanding: true } }),
    prisma.personalLoan.aggregate({ where: { memberId, direction: "borrowed", status: "open" }, _sum: { outstanding: true } }),
  ]);
  return { owed: lentAgg._sum.outstanding ?? 0, borrowed: borrowedAgg._sum.outstanding ?? 0 };
}

// The member's total unpaid credit-card obligation across ALL cycles (what you still owe
// on cards, regardless of month). Pairs with `remaining` to show true spendable-after-cards.
export async function getUnpaidCardDues(memberId: number): Promise<number> {
  const dues = await getCardDues(memberId);
  return dues.reduce((s, d) => s + d.unpaidTotal, 0);
}

// ── "On card, unpaid" — per credit card, the CC-tagged items grouped into billing cycles ──
// `family` items are family-view spends mirrored onto this card (the family reimburses them), shown
// for visibility with a tag. They are counted in `familyTotal` / `familyUnpaidTotal` ONLY — never in
// `total` / `unpaidTotal`, which stay personal-only so the month spendable & cash-in-hand are unchanged.
export type CardDueItem = { label: string; amount: number; dateISO: string; family: boolean; budgeted?: boolean; category?: string | null; peer?: boolean; billPay?: boolean; billPaymentId?: number | null };
// The budgeted family portion, split by the spend's budget month (a 16th–15th cycle spans two months).
export type MonthAmount = { monthISO: string; amount: number };
export type CardDueCycle = { cycleEndISO: string; dueISO: string | null; total: number; familyTotal: number; familyBudgeted: number; familyBudgetedByMonth: MonthAmount[]; annualFee: number; generated: boolean; items: CardDueItem[] };
export type CardDue = {
  cardId: number;
  cardName: string;
  color: string;
  needsStatementDay: boolean; // true → can't derive cycles; prompt to set one
  unpaidTotal: number; // Σ personal across all unpaid cycles (drives cash-in-hand)
  familyUnpaidTotal: number; // Σ family (reimbursed) across all unpaid cycles — display only
  cycles: CardDueCycle[]; // unpaid, oldest first — each carries its line items
  ungrouped: CardDueItem[]; // items shown when no statement day (can't derive cycles)
  // Settled cycles (for undo + a "paid" pill). familyTotal/total/dueISO come from the cycle's still-present
  // spends, so a paid FAMILY card bill can be shown/undone in the family plan even after it's settled.
  paid: { billId: number; cycleEndISO: string; amount: number; familyTotal: number; familyBudgeted: number; total: number; dueISO: string | null; paidAtISO: string; items: CardDueItem[] }[];
};

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// A month→amount map → a rounded, chronological list (drops empties). Used for the by-month budgeted split.
const monthList = (m: Map<string, number>): MonthAmount[] =>
  [...m.entries()]
    .map(([monthISO, amount]) => ({ monthISO, amount: Math.round(amount * 100) / 100 }))
    .filter((x) => x.amount > 0.005)
    .sort((a, b) => a.monthISO.localeCompare(b.monthISO));

// ── Balance cards (debit/prepaid) — no bill; a running balance + the spends drawn from it ──
export type BalanceCardView = {
  cardId: number;
  cardName: string;
  color: string;
  prepaid: boolean; // true = prepaid/wallet, false = debit
  balance: number; // current available balance (opening + top-ups − spends…)
  spends: CardDueItem[]; // spends on the card, newest first, family-tagged (same shape as credit items)
};

// Every active debit/prepaid card the member owns, with its derived balance and spend line items
// (personal + family, tagged). Shown alongside the credit dues so ALL cards live in one place.
export async function getBalanceCards(memberId: number): Promise<BalanceCardView[]> {
  const cards = await prisma.financeAccount.findMany({
    where: { memberId, type: { in: ["debit_card", "prepaid_card"] }, active: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  if (cards.length === 0) return [];
  const cardIds = cards.map((c) => c.id);
  const txns = await prisma.accountTransaction.findMany({
    where: { accountId: { in: cardIds } },
    select: { accountId: true, amount: true, date: true, merchant: true, type: true, source: true },
    orderBy: { date: "desc" },
  });
  const byCard = new Map<number, typeof txns>();
  for (const t of txns) {
    const arr = byCard.get(t.accountId) ?? [];
    arr.push(t);
    byCard.set(t.accountId, arr);
  }
  return cards.map((c) => {
    const ct = byCard.get(c.id) ?? [];
    const balance = computeBalance(c.openingBalance, ct.map((t) => ({ date: t.date, amount: t.amount, type: t.type })));
    const spends = ct
      .filter((t) => t.type === "spend")
      .map((t) => ({ label: t.merchant, amount: t.amount, dateISO: t.date.toISOString(), family: t.source === "family" }));
    return { cardId: c.id, cardName: c.name, color: c.color, prepaid: c.type === "prepaid_card", balance, spends };
  });
}

export async function getCardDues(memberId: number): Promise<CardDue[]> {
  const [cards, member] = await Promise.all([
    prisma.financeAccount.findMany({
      where: { memberId, type: "credit_card" },
      include: { credit: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    prisma.member.findUnique({ where: { id: memberId }, select: { householdId: true } }),
  ]);
  if (cards.length === 0) return [];

  const cardIds = cards.map((c) => c.id);
  const [spends, fixed, bills, categories, familyTxns, famBudgetedCats] = await Promise.all([
    prisma.personalSpend.findMany({ where: { memberId, cardAccountId: { not: null }, pending: false }, select: { cardAccountId: true, amount: true, date: true, note: true, categoryId: true } }),
    prisma.personalExpense.findMany({ where: { memberId, cardAccountId: { not: null }, pending: false }, select: { cardAccountId: true, amount: true, date: true, label: true } }),
    prisma.personalCardBill.findMany({ where: { memberId }, select: { id: true, cardAccountId: true, cycleEnd: true, amount: true, paidAt: true } }),
    prisma.personalCategory.findMany({ where: { memberId }, select: { id: true, name: true } }),
    // Mirrored spends this member's cards FRONT for someone else — the family (source "family", owner
    // bore a family spend) OR another member (source "peer", they spent on this card and owe the owner).
    // Both are reimbursed, so they're tracked apart in familyTotal and never touch the personal totals
    // (see below). The category name lets us split the family portion into budgeted vs misc.
    prisma.accountTransaction.findMany({ where: { accountId: { in: cardIds }, source: { in: ["family", "peer"] }, type: "spend" }, select: { accountId: true, amount: true, date: true, merchant: true, category: true, source: true, billPaymentId: true } }),
    // Household budgeted (tracked, non-misc) category NAMES — a family mirror line whose category matches
    // one of these was a budgeted spend (Fuel/provision); anything else is misc/other. Name-matched because
    // the mirror stores the family category's name (set at spend time).
    member ? prisma.category.findMany({ where: { householdId: member.householdId, tracked: true, section: { not: "Misc" } }, select: { name: true } }) : Promise.resolve([]),
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const budgetedNames = new Set(famBudgetedCats.map((c) => c.name));

  // Normalise personal spends + fixed lines (family:false) and family mirror lines (family:true) to a
  // common shape with a display label.
  type Item = { cardAccountId: number | null; amount: number; date: Date; label: string; family: boolean; budgeted: boolean; category?: string | null; peer?: boolean; billPay?: boolean; billPaymentId?: number | null };
  const items: Item[] = [
    ...spends.map((s) => ({ cardAccountId: s.cardAccountId, amount: s.amount, date: s.date, label: s.note?.trim() || catName.get(s.categoryId) || "Spend", family: false, budgeted: false })),
    ...fixed.map((e) => ({ cardAccountId: e.cardAccountId, amount: e.amount, date: e.date, label: e.label?.trim() || "Fixed bill", family: false, budgeted: false })),
    ...familyTxns.map((t) => ({ cardAccountId: t.accountId, amount: t.amount, date: t.date, label: t.merchant, family: true, budgeted: t.source !== "peer" && t.category != null && budgetedNames.has(t.category), category: t.category, peer: t.source === "peer", billPay: t.billPaymentId != null, billPaymentId: t.billPaymentId })),
  ];
  const out: CardDue[] = [];

  for (const card of cards) {
    const statementDay = card.credit?.statementDay ?? null;
    const dueOffset = card.credit?.dueOffsetDays ?? null;
    const mine = items.filter((it) => it.cardAccountId === card.id);
    const myBills = bills.filter((b) => b.cardAccountId === card.id);
    // Totals: personal drives the cash engine; family is reimbursed → tracked separately, display only.
    const personalAll = mine.filter((it) => !it.family).reduce((s, it) => s + it.amount, 0);
    const familyAll = mine.filter((it) => it.family).reduce((s, it) => s + it.amount, 0);
    if (mine.length === 0 && myBills.length === 0) continue; // nothing on this card, ever

    const toItem = (it: Item): CardDueItem => ({ label: it.label, amount: it.amount, dateISO: it.date.toISOString(), family: it.family, budgeted: it.budgeted, category: it.category ?? null, peer: !!it.peer, billPay: !!it.billPay, billPaymentId: it.billPaymentId ?? null });
    const byDateDesc = (a: CardDueItem, b: CardDueItem) => b.dateISO.localeCompare(a.dateISO);

    if (statementDay == null) {
      // Can't derive cycles without a statement day — show the totals, the items, and prompt to configure.
      out.push({ cardId: card.id, cardName: card.name, color: card.color, needsStatementDay: true, unpaidTotal: personalAll, familyUnpaidTotal: familyAll, cycles: [], ungrouped: mine.map(toItem).sort(byDateDesc), paid: [] });
      continue;
    }

    // Group items into billing cycles by their date; a cycle with a matching PersonalCardBill is settled
    // (its cash already left) and drops off. Personal → total; family → familyTotal (kept apart).
    const paidKeys = new Set(myBills.map((b) => midnight(b.cycleEnd).getTime()));
    const byCycle = new Map<number, { end: Date; due: Date | null; total: number; familyTotal: number; familyBudgeted: number; familyBudgetedByMonth: Map<string, number>; items: CardDueItem[] }>();
    for (const it of mine) {
      const cyc = currentCycle(statementDay, it.date, dueOffset);
      const key = midnight(cyc.end).getTime();
      const g = byCycle.get(key) ?? { end: midnight(cyc.end), due: cyc.dueDate, total: 0, familyTotal: 0, familyBudgeted: 0, familyBudgetedByMonth: new Map<string, number>(), items: [] };
      if (it.family) {
        g.familyTotal += it.amount;
        if (it.budgeted) {
          g.familyBudgeted += it.amount;
          // a 16th–15th cycle straddles two budget months → split the budgeted portion by the spend's
          // calendar month so the bill shows which month's held budget each part draws from.
          const mk = new Date(it.date.getFullYear(), it.date.getMonth(), 1).toISOString();
          g.familyBudgetedByMonth.set(mk, (g.familyBudgetedByMonth.get(mk) ?? 0) + it.amount);
        }
      } else g.total += it.amount;
      g.items.push(toItem(it));
      byCycle.set(key, g);
    }
    // Annual fee rides a cycle only when its statement (cycle-end) month is the card's fee month.
    const feeMonth = card.credit?.annualFeeMonth ?? null;
    const annualFeeOf = (end: Date) => (feeMonth != null && end.getMonth() + 1 === feeMonth ? Math.round((card.credit?.annualFee ?? 0) * 100) / 100 : 0);
    // A cycle's bill is GENERATED once its statement date (cycle-end) has arrived — only then can it be
    // paid. The in-progress cycle (statement date still in the future) is shown accumulating, no pay yet.
    const nowMid = midnight(new Date()).getTime();
    const cycles = [...byCycle.entries()]
      .filter(([key]) => !paidKeys.has(key))
      .sort((a, b) => a[0] - b[0])
      .map(([, g]) => ({ cycleEndISO: g.end.toISOString(), dueISO: g.due ? g.due.toISOString() : null, total: g.total, familyTotal: g.familyTotal, familyBudgeted: g.familyBudgeted, familyBudgetedByMonth: monthList(g.familyBudgetedByMonth), annualFee: annualFeeOf(g.end), generated: g.end.getTime() <= nowMid, items: g.items.sort(byDateDesc) }));
    const unpaidTotal = cycles.reduce((s, c) => s + c.total, 0);
    const familyUnpaidTotal = cycles.reduce((s, c) => s + c.familyTotal, 0);

    out.push({
      cardId: card.id,
      cardName: card.name,
      color: card.color,
      needsStatementDay: false,
      unpaidTotal,
      familyUnpaidTotal,
      cycles,
      ungrouped: [],
      paid: myBills.map((b) => {
        const g = byCycle.get(midnight(b.cycleEnd).getTime());
        return { billId: b.id, cycleEndISO: midnight(b.cycleEnd).toISOString(), amount: b.amount, familyTotal: g?.familyTotal ?? 0, familyBudgeted: g?.familyBudgeted ?? 0, total: g?.total ?? 0, dueISO: g?.due ? g.due.toISOString() : null, paidAtISO: b.paidAt.toISOString(), items: g ? [...g.items].sort(byDateDesc) : [] };
      }),
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
    const card = cards.find((c) => c.id === due.cardId);
    const window = card?.credit?.reminderDays ?? CARD_REMINDER_WINDOW_DAYS; // per-card lead time
    if (daysUntilDue > window) continue; // not near enough yet

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

// The member's PERSONAL money account and its real balance — what "In account now" shows. The account marked
// personalPrimary wins; with none marked, a member who has exactly ONE bank/cash/wallet account uses that one.
// null = can't tell (several accounts, none marked) → the page falls back to the calculated figure.
export async function getPersonalAccount(memberId: number): Promise<{ id: number; name: string; balance: number; toCome: number; toSend: number; otherName: string | null } | null> {
  const accts = await prisma.financeAccount.findMany({
    where: { memberId, active: true, type: { in: ["bank", "cash", "debit_card", "prepaid_card"] } },
    select: { id: true, name: true, openingBalance: true, personalPrimary: true },
  });
  const pick = accts.find((a) => a.personalPrimary) ?? (accts.length === 1 ? accts[0] : null);
  if (!pick) return null;
  const txns = await prisma.accountTransaction.findMany({ where: { accountId: pick.id }, select: { date: true, amount: true, type: true } });
  // A card bill paid from another account leaves a pending transfer for your share (e.g. "Jupiter → SBI"):
  // until it's ticked, that money is still here but owed to the other account (or the reverse).
  const moves = await prisma.personalPlanStep.findMany({
    where: { memberId, status: "pending", kind: "transfer", snapshot: { path: ["fundsCardBillStep"], not: Prisma.AnyNull }, OR: [{ fromAccountId: pick.id }, { toAccountId: pick.id }] },
    select: { amount: true, fromAccountId: true, toAccountId: true },
  });
  const other = moves.map((m) => (m.fromAccountId === pick.id ? m.toAccountId : m.fromAccountId)).find((x) => x != null) ?? null;
  const otherName = other != null ? (await prisma.financeAccount.findUnique({ where: { id: other }, select: { name: true } }))?.name ?? null : null;
  return {
    id: pick.id, name: pick.name, balance: computeBalance(pick.openingBalance, txns),
    toSend: moves.filter((m) => m.fromAccountId === pick.id).reduce((t, m) => t + m.amount, 0),
    toCome: moves.filter((m) => m.toAccountId === pick.id).reduce((t, m) => t + m.amount, 0),
    otherName,
  };
}

// The family's tracked categories that are live THIS (open) family month — where a card bill's extra charge
// or cashback can be booked from the personal pay window. Same rule as the family pickers (lib/load isLive):
// a budget or a Sheet line this month, or a permanent Misc bucket.
export async function getFamilyBookingCategories(memberId: number): Promise<{ id: number; name: string }[]> {
  const m = await prisma.member.findUnique({ where: { id: memberId }, select: { householdId: true } });
  if (!m) return [];
  const open = await prisma.period.findFirst({ where: { householdId: m.householdId, status: "open" }, orderBy: [{ year: "desc" }, { month: "desc" }], select: { id: true } });
  const cats = await prisma.category.findMany({ where: { householdId: m.householdId, tracked: true }, orderBy: [{ section: "asc" }, { name: "asc" }], select: { id: true, name: true, section: true, miscCard: true } });
  if (!open) return cats.map((c) => ({ id: c.id, name: c.name }));
  const [bud, lines] = await Promise.all([
    prisma.budget.findMany({ where: { periodId: open.id, planned: { gt: 0 } }, select: { categoryId: true } }),
    prisma.expenseEntry.findMany({ where: { periodId: open.id, OR: [{ note: null }, { note: { not: REMOVED_NOTE } }] }, select: { categoryId: true }, distinct: ["categoryId"] }),
  ]);
  const live = new Set([...bud, ...lines].map((r) => r.categoryId).filter((x): x is number => x != null));
  return cats.filter((c) => live.has(c.id) || (c.section === "Misc" && !c.miscCard)).map((c) => ({ id: c.id, name: c.name }));
}
