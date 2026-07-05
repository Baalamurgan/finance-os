import type { Prisma } from "@prisma/client";

/**
 * Build a new month's structure from the previous one + the Setup template.
 * Single source of truth for both createPeriod (manual/wind-down) and
 * ensureCurrentMonth (cron/local), so they can't drift.
 *
 * Rules (the family's model):
 * - Income lines copy forward (skip one-off negative adjustments).
 * - "Setup categories" (a monthly amount set, not held) become ONE tagged Sheet
 *   line regenerated from the CURRENT template — amount = monthlyBudget, tagged to
 *   the responsible/paying member (so settlement subtracts it), label kept from
 *   the previous line if any (else the category name; sinking → "… (monthly share)").
 *   This is what makes Setup changes take effect from next month.
 * - Every OTHER non-one-off line (loans, chits, manual entries) clones as-is.
 * - Budgets are seeded only for Budget categories (fixed bills have none).
 * - Held categories are skipped entirely.
 */
export async function clonePeriodInto(
  tx: Prisma.TransactionClient,
  sourceId: number,
  targetId: number,
  householdId: number,
) {
  const [incomes, expenses, cats] = await Promise.all([
    tx.incomeEntry.findMany({ where: { periodId: sourceId, oneOff: false } }),
    tx.expenseEntry.findMany({ where: { periodId: sourceId, oneOff: false } }),
    tx.category.findMany({
      where: { householdId },
      select: {
        id: true, name: true, sinking: true, monthlyBudget: true,
        necessary: true, onHold: true, responsibleMemberId: true,
      },
    }),
  ]);

  const held = new Set(cats.filter((c) => c.onHold).map((c) => c.id));
  const setupCats = cats.filter((c) => c.monthlyBudget != null && c.monthlyBudget > 0 && !c.onHold);
  const setupIds = new Set(setupCats.map((c) => c.id));
  const prevLabel = new Map<number, string>();
  for (const e of expenses) if (!prevLabel.has(e.categoryId)) prevLabel.set(e.categoryId, e.label);

  for (const i of incomes) {
    if (i.amount < 0) continue; // one-off adjustments (misc/piggy) don't repeat
    await tx.incomeEntry.create({ data: { periodId: targetId, source: i.source, amount: i.amount, ownerId: i.ownerId } });
  }

  // clone non-Setup lines (loans, chits, manual) — Setup categories are regenerated below
  for (const e of expenses) {
    if (held.has(e.categoryId)) continue;
    if (setupIds.has(e.categoryId)) continue;
    await tx.expenseEntry.create({
      data: { periodId: targetId, label: e.label, amount: e.amount, categoryId: e.categoryId, memberId: e.memberId, necessary: e.necessary },
    });
  }

  // one tagged Sheet line per Setup category, from the current template
  for (const c of setupCats) {
    const label = c.sinking ? `${c.name} (monthly share)` : (prevLabel.get(c.id) ?? c.name);
    await tx.expenseEntry.create({
      data: { periodId: targetId, categoryId: c.id, label, amount: c.monthlyBudget!, memberId: c.responsibleMemberId, necessary: c.necessary },
    });
  }

  // budgets: sinking funds only (they reconcile share-vs-spent → Piggy at wind-down).
  // Flat monthly expenses need no budget — they're just tagged Sheet lines.
  for (const c of setupCats) {
    if (!c.sinking) continue;
    await tx.budget.create({ data: { periodId: targetId, categoryId: c.id, planned: c.monthlyBudget! } });
  }
}
