import { prisma } from "@/lib/prisma";
import { computeCreditDashboard } from "@/lib/finance/creditDashboard";
import { computeBalance } from "@/lib/finance/balance";
import { netWorthTypeMeta, BALANCE_ACCOUNT_TYPES, type LedgerTxn } from "@/lib/finance/types";

// Wallet list: every account the member owns + a light summary per credit card
// (outstanding + utilisation) for its tile, or a derived balance per debit/prepaid card.
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
    // Debit/prepaid: a spendable balance instead of a credit summary.
    const balance = BALANCE_ACCOUNT_TYPES.has(a.type)
      ? computeBalance(a.openingBalance, byAccount.get(a.id) ?? [])
      : null;
    return { account: a, txnCount: a._count.txns, summary, balance };
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
  const ledger = txns.map((t) => ({ date: t.date, amount: t.amount, type: t.type, rewardPoints: t.rewardPoints }));
  const dashboard = computeCreditDashboard({
    creditLimit: account.credit?.creditLimit,
    statementDay: account.credit?.statementDay,
    dueOffsetDays: account.credit?.dueOffsetDays,
    txns: ledger,
  });
  const balance = BALANCE_ACCOUNT_TYPES.has(account.type) ? computeBalance(account.openingBalance, ledger) : null;
  return { account, txns, dashboard, balance };
}

// Full net-worth picture for a member. Manual holdings (NetWorthItem) + auto-included
// credit-card outstanding (AccountTransaction) + open lending/borrowing (PersonalLoan).
// Net worth = total assets − total liabilities. Nothing here is AI/estimated — every
// number is a value the user entered or a deterministic sum of their own data.
export async function getNetWorth(memberId: number) {
  const [items, loans, creditCards, balanceCards, txns] = await Promise.all([
    prisma.netWorthItem.findMany({ where: { memberId }, orderBy: { value: "desc" } }),
    prisma.personalLoan.findMany({ where: { memberId, status: "open" } }),
    prisma.financeAccount.findMany({ where: { memberId, type: "credit_card" }, include: { credit: true } }),
    prisma.financeAccount.findMany({ where: { memberId, type: { in: ["debit_card", "prepaid_card"] } } }),
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

  // debit/prepaid balances — spendable money you hold (an asset). Clamp at 0 (an overdrawn card is not
  // a negative asset here; it'd be a liability we don't model yet).
  const balanceAccounts = balanceCards.map((c) => ({
    id: c.id, name: c.name, color: c.color,
    balance: Math.max(0, computeBalance(c.openingBalance, byAccount.get(c.id) ?? [])),
  }));

  const assetItems = items.filter((i) => i.category === "asset");
  const liabilityItems = items.filter((i) => i.category === "liability");
  const lentOutstanding = loans.filter((l) => l.direction === "lent").reduce((s, l) => s + l.outstanding, 0);
  const borrowedOutstanding = loans.filter((l) => l.direction === "borrowed").reduce((s, l) => s + l.outstanding, 0);
  const cardsOutstanding = cards.reduce((s, c) => s + c.outstanding, 0);
  const cardBalances = balanceAccounts.reduce((s, c) => s + c.balance, 0);

  const totalAssets = assetItems.reduce((s, i) => s + i.value, 0) + lentOutstanding + cardBalances;
  const totalLiabilities = liabilityItems.reduce((s, i) => s + i.value, 0) + borrowedOutstanding + cardsOutstanding;
  const netWorth = totalAssets - totalLiabilities;

  // asset allocation by type (for the "where's my money" breakdown), incl. lent money + card balances
  const allocMap = new Map<string, number>();
  for (const i of assetItems) allocMap.set(i.type, (allocMap.get(i.type) ?? 0) + i.value);
  if (lentOutstanding > 0) allocMap.set("lent", lentOutstanding);
  if (cardBalances > 0) allocMap.set("card_balance", cardBalances);
  const allocation = [...allocMap.entries()]
    .map(([type, value]) => ({
      type,
      value,
      label: type === "lent" ? "Money lent" : type === "card_balance" ? "Card balances" : netWorthTypeMeta(type).label,
      icon: type === "lent" ? "🤝" : type === "card_balance" ? "💳" : netWorthTypeMeta(type).icon,
      pct: totalAssets > 0 ? (value / totalAssets) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  return {
    assetItems,
    liabilityItems,
    cards,
    balanceAccounts,
    lentOutstanding,
    borrowedOutstanding,
    cardsOutstanding,
    cardBalances,
    totalAssets,
    totalLiabilities,
    netWorth,
    allocation,
    hasAny: items.length > 0 || loans.length > 0 || cards.length > 0 || balanceAccounts.length > 0,
  };
}
