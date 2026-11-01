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

// Heal for the same auto-settle: it flipped EVERY due bill to "paid", but only left a marker where a bank/cash
// account was named — so a bill with no account (or on a card) was marked paid with nothing to trace and never
// returned as a step. In a month still being worked, a recurring bill/spend that is marked paid yet has NO
// step at all (not even a done or removed one) was never actually paid through the plan: it is the leftover of
// that auto-settle, or a Setup item added this month. Put it back to "planned" so it appears as a step.
// Closed months are history and are left alone. Idempotent: once it has a step it is never touched again.
export async function replanUnplanned(memberId: number, periodId: number): Promise<void> {
  const period = await prisma.personalPeriod.findFirst({ where: { id: periodId, memberId }, select: { status: true } });
  if (!period || period.status === "closed") return;
  const steps = await prisma.personalPlanStep.findMany({
    where: { periodId, memberId, templateKind: { in: ["expense", "spend"] }, templateId: { not: null } },
    select: { templateKind: true, templateId: true },
  });
  const has = (kind: string) => steps.filter((s) => s.templateKind === kind).map((s) => s.templateId as number);
  const exp = has("expense");
  const spd = has("spend");
  await prisma.$transaction([
    prisma.personalExpense.updateMany({ where: { periodId, memberId, recurring: true, pending: false, id: { notIn: exp.length ? exp : [0] } }, data: { pending: true } }),
    prisma.personalSpend.updateMany({ where: { periodId, memberId, recurring: true, pending: false, id: { notIn: spd.length ? spd : [0] } }, data: { pending: true } }),
  ]);
}
