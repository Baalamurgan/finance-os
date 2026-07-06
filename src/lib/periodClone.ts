import type { Prisma } from "@prisma/client";

/**
 * Generate a month's structure from the RecurringItem TEMPLATE (the source of
 * truth), instead of cloning the previous month. Single generation point for
 * createPeriod / windDownMonth / ensureCurrentMonth / the next-month draft.
 *
 * Lays down ONLY the template:
 * - each active RecurringItem → an income / expense line (tagged to its member),
 * - budgets for tracked, non-held categories = Σ their active expense items' amounts.
 * The month's CARRY (surplus → income, misc-per-spend, over-budget) is added by the
 * callers (windDownMonth / the draft's addEstimatedSurplus + addEstimatedCarry),
 * exactly as before — this only replaces the "clone previous month" step.
 */
export async function generateMonth(
  tx: Prisma.TransactionClient,
  targetId: number,
  householdId: number,
) {
  const [period, items, cats] = await Promise.all([
    tx.period.findUnique({ where: { id: targetId }, select: { year: true, month: true } }),
    tx.recurringItem.findMany({ where: { householdId, active: true }, orderBy: { sortOrder: "asc" } }),
    tx.category.findMany({ where: { householdId }, select: { id: true, tracked: true, onHold: true, necessary: true, monthlyBudget: true } }),
  ]);
  const catById = new Map(cats.map((c) => [c.id, c]));

  // For a fixed-term installment, this month's payment number (or null if the item
  // isn't due this month — before it starts or after the last). Returns the label.
  type Item = (typeof items)[number];
  const dueLabel = (it: Item): string | null => {
    if (it.installmentsTotal == null || it.installmentStartYear == null || it.installmentStartMonth == null) return it.name;
    const n = (period!.year - it.installmentStartYear) * 12 + (period!.month - it.installmentStartMonth) + 1;
    if (n < 1 || n > it.installmentsTotal) return null; // not due this month
    return `${it.name} ${n}/${it.installmentsTotal}`;
  };

  for (const it of items) {
    const label = dueLabel(it);
    if (label == null) continue; // installment outside its schedule
    if (it.kind === "income") {
      await tx.incomeEntry.create({
        data: { periodId: targetId, source: label, amount: it.amount, ownerId: it.memberId, oneOff: false },
      });
      continue;
    }
    // expense
    if (it.categoryId == null) continue;
    const cat = catById.get(it.categoryId);
    if (cat?.onHold) continue; // held category → not generated
    await tx.expenseEntry.create({
      data: {
        periodId: targetId,
        label,
        amount: it.amount,
        categoryId: it.categoryId,
        memberId: it.memberId,
        necessary: cat?.necessary ?? true,
        oneOff: false,
      },
    });
  }

  // budgets: only intentionally-budgeted categories (tracked, non-held, with a
  // monthlyBudget set) — NOT the misc bucket. Planned = Σ their active items due this month.
  const budgetByCat = new Map<number, number>();
  for (const it of items) {
    if (it.kind !== "expense" || it.categoryId == null || dueLabel(it) == null) continue;
    const cat = catById.get(it.categoryId);
    if (!cat?.tracked || cat.onHold || cat.monthlyBudget == null) continue;
    budgetByCat.set(it.categoryId, (budgetByCat.get(it.categoryId) ?? 0) + it.amount);
  }
  for (const [categoryId, planned] of budgetByCat) {
    await tx.budget.create({ data: { periodId: targetId, categoryId, planned } });
  }
}
