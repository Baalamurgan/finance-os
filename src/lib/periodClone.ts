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
    tx.category.findMany({ where: { householdId }, select: { id: true, name: true, tracked: true, sinking: true, onHold: true, necessary: true, monthlyBudget: true, responsibleMemberId: true } }),
  ]);
  const catById = new Map(cats.map((c) => [c.id, c]));
  // categories that already produce a line via a recurring item — so we don't
  // double-book the budget-only (orphan) synthesis below.
  const catsWithItems = new Set(
    items.filter((i) => i.kind === "expense" && i.categoryId != null).map((i) => i.categoryId as number),
  );

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
  // Budget-only categories: a tracked/sinking category budgeted in Setup's
  // "Budgets & sinking funds" but with NO recurring line of its own (e.g. a sinking
  // fund added straight there). Mirror what the item-backed ones get — a monthly-share
  // expense line tagged to whoever's responsible + a budget — so next month counts it
  // and settlement subtracts it. Guarded by catsWithItems so nothing double-books.
  for (const cat of cats) {
    if (!cat.tracked || cat.onHold || cat.monthlyBudget == null || cat.monthlyBudget <= 0) continue;
    if (catsWithItems.has(cat.id)) continue; // already produced by a recurring item
    const label = cat.sinking ? `${cat.name} (monthly share)` : cat.name;
    await tx.expenseEntry.create({
      data: {
        periodId: targetId,
        label,
        amount: cat.monthlyBudget,
        categoryId: cat.id,
        memberId: cat.responsibleMemberId,
        necessary: cat.necessary ?? true,
        oneOff: false,
      },
    });
    budgetByCat.set(cat.id, cat.monthlyBudget);
  }

  for (const [categoryId, planned] of budgetByCat) {
    await tx.budget.create({ data: { periodId: targetId, categoryId, planned } });
  }
}
