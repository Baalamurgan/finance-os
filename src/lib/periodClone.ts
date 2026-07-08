import type { Prisma } from "@prisma/client";
import { scheduleOccurrence, scheduleLabel, isLumpDue, planBillMonth, type FundingStyle } from "@/lib/schedule";

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
  const [period, items, cats, funds] = await Promise.all([
    tx.period.findUnique({ where: { id: targetId }, select: { year: true, month: true } }),
    tx.recurringItem.findMany({ where: { householdId, active: true }, orderBy: { sortOrder: "asc" } }),
    tx.category.findMany({ where: { householdId }, select: { id: true, name: true, tracked: true, sinking: true, onHold: true, necessary: true, monthlyBudget: true, responsibleMemberId: true, billEveryMonths: true, billMonth: true, billAmount: true, fundingStyle: true } }),
    tx.piggyEntry.groupBy({ by: ["categoryId"], where: { householdId, kind: "sinking" }, _sum: { amount: true } }),
  ]);
  const catById = new Map(cats.map((c) => [c.id, c]));
  // current fund balance per category (goal-based bills read this to size the set-aside)
  const fundByCat = new Map<number, number>();
  for (const f of funds) if (f.categoryId != null) fundByCat.set(f.categoryId, f._sum.amount ?? 0);
  const isBillWithFund = (categoryId: number | null): boolean => {
    if (categoryId == null) return false;
    const c = catById.get(categoryId);
    return !!c && c.fundingStyle != null;
  };
  // A "budgeted" category (tracked envelope OR flat fixed bill) owns its own monthly amount
  // in Budgets & sinking funds — it's generated from the Category below, so its
  // RecurringItems (if any) are skipped so nothing double-books. (Full-bill categories have
  // monthlyBudget = null, so they are naturally excluded here and handled by their own loop.)
  const isBudgeted = (categoryId: number | null): boolean => {
    if (categoryId == null) return false;
    const c = catById.get(categoryId);
    return !!c && c.fundingStyle == null && !c.onHold && c.monthlyBudget != null && c.monthlyBudget > 0;
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
    if (isBillWithFund(it.categoryId)) continue; // goal-based bill → generated from the Category (below)
    if (cat?.billEveryMonths != null) continue; // full-bill category → generated from the Category (below), never double-booked
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

  // Full-bill categories: the whole bill lands as ONE expense line only in its due month(s)
  // (yearly insurance, every-2-months EMI) — no monthly share, no fund. The alternative to
  // a sinking fund for a periodic bill. Just a normal expense in its month → counts in the
  // sheet total, carry and settlement like any other line.
  for (const cat of cats) {
    if (cat.fundingStyle != null) continue; // goal-based bill-with-a-fund → handled below
    if (cat.onHold || cat.billEveryMonths == null || cat.billAmount == null || cat.billAmount <= 0) continue;
    if (!isLumpDue(cat.billMonth ?? 1, cat.billEveryMonths, period!)) continue;
    await tx.expenseEntry.create({
      data: {
        periodId: targetId,
        label: cat.name,
        amount: cat.billAmount,
        categoryId: cat.id,
        memberId: cat.responsibleMemberId,
        necessary: cat.necessary ?? true,
        oneOff: false,
      },
    });
  }

  // Goal-based "bill with a fund": each month either sets aside toward the bill, pays it
  // (full bill + a fund credit → net out-of-pocket), or does nothing (pay-in-full style).
  // All lines are tagged to the responsible member, so settlement nets them automatically.
  const mkLine = (cat: (typeof cats)[number], label: string, amount: number) =>
    tx.expenseEntry.create({
      data: { periodId: targetId, label, amount, categoryId: cat.id, memberId: cat.responsibleMemberId, necessary: cat.necessary ?? true, oneOff: false },
    });
  for (const cat of cats) {
    if (cat.fundingStyle == null || cat.onHold) continue;
    if (cat.billAmount == null || cat.billAmount <= 0 || cat.billMonth == null || cat.billEveryMonths == null) continue;
    const plan = planBillMonth({
      billAmount: cat.billAmount,
      billMonth: cat.billMonth,
      everyMonths: cat.billEveryMonths,
      fund: fundByCat.get(cat.id) ?? 0,
      fundingStyle: cat.fundingStyle as FundingStyle,
      fixedShare: cat.monthlyBudget,
      month: period!.month,
    });
    if (plan.kind === "bill") {
      await mkLine(cat, cat.name, plan.bill);
      if (plan.fromFund > 0) await mkLine(cat, `${cat.name} — from fund`, -plan.fromFund);
    } else if (plan.kind === "save" && plan.contribution > 0) {
      await mkLine(cat, `${cat.name} (saving)`, plan.contribution);
    }
  }
}
