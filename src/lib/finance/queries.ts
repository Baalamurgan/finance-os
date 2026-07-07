import { prisma } from "@/lib/prisma";
import { computeCreditDashboard } from "@/lib/finance/creditDashboard";
import type { LedgerTxn } from "@/lib/finance/types";

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
