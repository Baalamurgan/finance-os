import type { Prisma } from "@prisma/client";

/**
 * Generate a month's structure from the RecurringItem TEMPLATE (the source of
 * truth), instead of cloning the previous month. Single generation point for
 * createPeriod / windDownMonth / ensureCurrentMonth / the next-month draft.
 *
 * Two sources, one place each:
 * - Income + non-budgeted expense lines (loans, fixed bills, cook, misc, installments)
 *   come from the active RecurringItems, tagged to their member.
 * - "Envelope" categories — tracked, non-held, with a monthlyBudget set — are the single
 *   source for their own monthly amount: each generates ONE expense line (= monthlyBudget,
 *   tagged to whoever's responsible) plus a Budget = monthlyBudget. Any RecurringItem in an
 *   envelope category is ignored here so nothing double-books.
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
  // An "envelope" category owns its own monthly amount (Budgets & sinking funds) — it's
  // generated from the Category below, so its RecurringItems (if any) are skipped.
  const isEnvelope = (categoryId: number | null): boolean => {
    if (categoryId == null) return false;
    const c = catById.get(categoryId);
    return !!c && c.tracked && !c.onHold && c.monthlyBudget != null && c.monthlyBudget > 0;
  };

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
    if (isEnvelope(it.categoryId)) continue; // envelope category → generated from the Category, not the item
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

  // Envelope categories: the single source for their monthly amount. One expense line
  // (= monthlyBudget, tagged to who's responsible) + one budget, so the amount lives in
  // exactly one place (Budgets & sinking funds) and always reflects on rebuild.
  for (const cat of cats) {
    if (!cat.tracked || cat.onHold || cat.monthlyBudget == null || cat.monthlyBudget <= 0) continue;
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
    await tx.budget.create({ data: { periodId: targetId, categoryId: cat.id, planned: cat.monthlyBudget } });
  }
}
