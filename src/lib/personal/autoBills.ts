import { prisma } from "@/lib/prisma";

// Recurring bills are Money-Plan steps again: they're set aside in the month from day one, and ticking the step
// pays them from the chosen account. An earlier version settled them automatically on the due day, leaving a
// marker-tagged ledger line and the row flagged paid. This undoes that for any bill it touched — the debit is
// removed and the bill goes back to "planned", so it shows as a normal unpaid step instead of a silent,
// back-dated debit. Idempotent: once reverted there is nothing left to find.
const AUTO_MARKER_PREFIX = "__billauto__:";

export async function revertAutoBills(memberId: number): Promise<void> {
  const lines = await prisma.accountTransaction.findMany({
    where: { memberId, category: { startsWith: AUTO_MARKER_PREFIX } },
    select: { id: true, category: true },
  });
  if (lines.length === 0) return;
  const expenseIds = lines.map((l) => Number((l.category ?? "").slice(AUTO_MARKER_PREFIX.length))).filter((n) => n > 0);
  await prisma.$transaction([
    prisma.accountTransaction.deleteMany({ where: { id: { in: lines.map((l) => l.id) } } }),
    prisma.personalExpense.updateMany({ where: { id: { in: expenseIds }, memberId }, data: { pending: true } }),
  ]);
}
