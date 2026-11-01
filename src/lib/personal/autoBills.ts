import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

// Recurring BILLS (Setup → Recurring expenses) are budget lines, not Money-Plan steps: they are set aside in
// the month from day one, and — like a standing instruction at the bank — they settle THEMSELVES on their due
// day. Settling flips the row from "planned" (pending) to paid and, when the bill names a bank/cash account
// to pay from, debits that account's ledger with a marker-tagged line dated the due day. Cards need nothing
// more (the bill rides the card's statement). Idempotent: only still-pending rows are touched.
export const billAutoMarker = (expenseId: number) => `__billauto__:${expenseId}`;

// "YYYYMMDD" of a date by its LOCAL parts — the same parts recurDate() built the row's date from.
const dayKey = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

export async function settleDueBills(memberId: number, now: Date = new Date()): Promise<void> {
  const ist = new Date(now.getTime() + 330 * 60000); // today in IST, the app's clock
  const today = ist.getUTCFullYear() * 10000 + (ist.getUTCMonth() + 1) * 100 + ist.getUTCDate();
  const pending = await prisma.personalExpense.findMany({
    where: { memberId, pending: true, period: { status: { not: "draft" } } },
    select: { id: true, label: true, amount: true, date: true, payAccountId: true },
  });
  const due = pending.filter((e) => dayKey(e.date) <= today);
  if (due.length === 0) return;
  const accts = await prisma.financeAccount.findMany({
    where: { memberId, active: true, id: { in: due.map((e) => e.payAccountId).filter((x): x is number => x != null) }, type: { in: ["bank", "cash"] } },
    select: { id: true },
  });
  const payable = new Set(accts.map((a) => a.id));
  await prisma.$transaction(
    due.flatMap((e) => [
      prisma.personalExpense.update({ where: { id: e.id }, data: { pending: false } }),
      ...(e.payAccountId != null && payable.has(e.payAccountId)
        ? [
            prisma.accountTransaction.deleteMany({ where: { memberId, category: billAutoMarker(e.id) } }),
            prisma.accountTransaction.create({ data: { memberId, accountId: e.payAccountId, date: e.date, merchant: e.label || "Bill", amount: Math.round(e.amount * 100) / 100, type: "spend", category: billAutoMarker(e.id), source: "manual" } }),
          ]
        : []),
    ]),
  );
}

// A bill whose details changed (or that is being removed) must not leave its auto-debit behind. If it had
// auto-settled, drop that ledger line and put the row back to "planned" so it re-settles with the new
// amount / account / date. Safe on any row: a bill that never auto-settled is left exactly as it was.
export async function resetAutoBill(tx: Prisma.TransactionClient, memberId: number, expenseId: number): Promise<void> {
  const del = await tx.accountTransaction.deleteMany({ where: { memberId, category: billAutoMarker(expenseId) } });
  if (del.count > 0) await tx.personalExpense.updateMany({ where: { id: expenseId, memberId }, data: { pending: true } });
}
