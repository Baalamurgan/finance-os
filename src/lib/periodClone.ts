import type { Prisma } from "@prisma/client";
import { scheduleOccurrence, scheduleLabel } from "@/lib/schedule";

/**
 * Generate a month's structure from the RecurringItem TEMPLATE (the source of
 * truth), instead of cloning the previous month. Single generation point for
 * createPeriod / windDownMonth / ensureCurrentMonth / the next-month draft.
 *
 * Two sources, one place each:
 * - Income + non-budgeted expense lines (loans, cook, misc, installments) come from the
 *   active RecurringItems, tagged to their member.
 * - "Budgeted" categories — non-held, with a monthlyBudget set (tracked envelopes AND
 *   flat fixed bills) — are the single source for their own monthly amount: each generates
 *   ONE expense line (= monthlyBudget, tagged to whoever's responsible). Tracked (spend-
 *   tracked) categories additionally get a Budget = monthlyBudget; flat fixed bills get the
 *   line only. Any RecurringItem in a budgeted category is ignored so nothing double-books.
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
  // A "budgeted" category (tracked envelope OR flat fixed bill) owns its own monthly amount
  // in Budgets & sinking funds — it's generated from the Category below, so its
  // RecurringItems (if any) are skipped so nothing double-books.
  const isBudgeted = (categoryId: number | null): boolean => {
    if (categoryId == null) return false;
    const c = catById.get(categoryId);
    return !!c && !c.onHold && c.monthlyBudget != null && c.monthlyBudget > 0;
  };

  // Schedule (every month / installment N times / periodic every N months) → this month's
  // label, or null if the item isn't due this month. See src/lib/schedule.ts.
  type Item = (typeof items)[number];
  const dueLabel = (it: Item): string | null => {
    const { due, n } = scheduleOccurrence(it, period!);
    if (!due) return null;
    return scheduleLabel(it.name, it.installmentsTotal, n);
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
    if (isBudgeted(it.categoryId)) continue; // budgeted category → generated from the Category, not the item
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

  // Budgeted categories: the single source for their monthly amount. One expense line
  // (= monthlyBudget, tagged to who's responsible) so the amount lives in exactly one
  // place (Budgets & sinking funds) and always reflects on rebuild. Tracked (spend-tracked)
  // categories also get a Budget envelope; flat fixed bills get the line only.
  for (const cat of cats) {
    if (cat.onHold || cat.monthlyBudget == null || cat.monthlyBudget <= 0) continue;
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
    if (cat.tracked) {
      await tx.budget.create({ data: { periodId: targetId, categoryId: cat.id, planned: cat.monthlyBudget } });
    }
  }
}
