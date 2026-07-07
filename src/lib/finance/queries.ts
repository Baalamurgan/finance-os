import { prisma } from "@/lib/prisma";
import { computeCreditDashboard } from "@/lib/finance/creditDashboard";
import { netWorthTypeMeta, type LedgerTxn } from "@/lib/finance/types";

// Wallet list: every account the member owns + a light summary per credit card
// (outstanding + utilisation) for its tile. Debit cards are informational only.
export async function getWalletAccounts(memberId: number) {
  const accounts = await prisma.financeAccount.findMany({
    where: { memberId },
    include: { credit: true, _count: { select: { txns: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  // one grouped txn fetch, then summarise per account (avoids N+1)
  const txns = await prisma.accountTransaction.findMany({
    where: { memberId },
    select: { accountId: true, date: true, amount: true, type: true, rewardPoints: true },
  });
  const byAccount = new Map<number, LedgerTxn[]>();
  for (const t of txns) {
    const arr = byAccount.get(t.accountId) ?? [];
    arr.push({ date: t.date, amount: t.amount, type: t.type, rewardPoints: t.rewardPoints });
    byAccount.set(t.accountId, arr);
  }
  return accounts.map((a) => {
    const summary =
      a.type === "credit_card"
        ? computeCreditDashboard({
            creditLimit: a.credit?.creditLimit,
            statementDay: a.credit?.statementDay,
            dueOffsetDays: a.credit?.dueOffsetDays,
            txns: byAccount.get(a.id) ?? [],
          })
        : null;
    return { account: a, txnCount: a._count.txns, summary };
  });
}

// Full detail for one credit-card account (owner-scoped). Returns null if not found/owned.
export async function getAccountDetail(memberId: number, accountId: number) {
  const account = await prisma.financeAccount.findFirst({
    where: { id: accountId, memberId },
    include: { credit: true },
  });
  if (!account) return null;
  const txns = await prisma.accountTransaction.findMany({
    where: { accountId, memberId },
    orderBy: { date: "desc" },
  });
  const dashboard = computeCreditDashboard({
    creditLimit: account.credit?.creditLimit,
    statementDay: account.credit?.statementDay,
    dueOffsetDays: account.credit?.dueOffsetDays,
    txns: txns.map((t) => ({ date: t.date, amount: t.amount, type: t.type, rewardPoints: t.rewardPoints })),
  });
  return { account, txns, dashboard };
}

// Full net-worth picture for a member. Manual holdings (NetWorthItem) + auto-included
// credit-card outstanding (AccountTransaction) + open lending/borrowing (PersonalLoan).
// Net worth = total assets − total liabilities. Nothing here is AI/estimated — every
// number is a value the user entered or a deterministic sum of their own data.
export async function getNetWorth(memberId: number) {
  const [items, loans, creditCards, txns] = await Promise.all([
    prisma.netWorthItem.findMany({ where: { memberId }, orderBy: { value: "desc" } }),
    prisma.personalLoan.findMany({ where: { memberId, status: "open" } }),
    prisma.financeAccount.findMany({ where: { memberId, type: "credit_card" }, include: { credit: true } }),
    prisma.accountTransaction.findMany({
      where: { memberId },
      select: { accountId: true, date: true, amount: true, type: true, rewardPoints: true },
    }),
  ]);

  const byAccount = new Map<number, LedgerTxn[]>();
  for (const t of txns) {
    const arr = byAccount.get(t.accountId) ?? [];
    arr.push({ date: t.date, amount: t.amount, type: t.type, rewardPoints: t.rewardPoints });
    byAccount.set(t.accountId, arr);
  }
  // each card's outstanding (clamped at 0 for net worth — an overpaid card isn't a debt)
  const cards = creditCards.map((c) => {
    const d = computeCreditDashboard({
      creditLimit: c.credit?.creditLimit,
      statementDay: c.credit?.statementDay,
      dueOffsetDays: c.credit?.dueOffsetDays,
      txns: byAccount.get(c.id) ?? [],
    });
    return { id: c.id, name: c.name, color: c.color, outstanding: Math.max(0, d.outstanding) };
  });

  const assetItems = items.filter((i) => i.category === "asset");
  const liabilityItems = items.filter((i) => i.category === "liability");
  const lentOutstanding = loans.filter((l) => l.direction === "lent").reduce((s, l) => s + l.outstanding, 0);
  const borrowedOutstanding = loans.filter((l) => l.direction === "borrowed").reduce((s, l) => s + l.outstanding, 0);
  const cardsOutstanding = cards.reduce((s, c) => s + c.outstanding, 0);

  const totalAssets = assetItems.reduce((s, i) => s + i.value, 0) + lentOutstanding;
  const totalLiabilities = liabilityItems.reduce((s, i) => s + i.value, 0) + borrowedOutstanding + cardsOutstanding;
  const netWorth = totalAssets - totalLiabilities;

  // asset allocation by type (for the "where's my money" breakdown), incl. lent money
  const allocMap = new Map<string, number>();
  for (const i of assetItems) allocMap.set(i.type, (allocMap.get(i.type) ?? 0) + i.value);
  if (lentOutstanding > 0) allocMap.set("lent", lentOutstanding);
  const allocation = [...allocMap.entries()]
    .map(([type, value]) => ({
      type,
      value,
      label: type === "lent" ? "Money lent" : netWorthTypeMeta(type).label,
      icon: type === "lent" ? "🤝" : netWorthTypeMeta(type).icon,
      pct: totalAssets > 0 ? (value / totalAssets) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  return {
    assetItems,
    liabilityItems,
    cards,
    lentOutstanding,
    borrowedOutstanding,
    cardsOutstanding,
    totalAssets,
    totalLiabilities,
    netWorth,
    allocation,
    hasAny: items.length > 0 || loans.length > 0 || cards.length > 0,
  };
}
