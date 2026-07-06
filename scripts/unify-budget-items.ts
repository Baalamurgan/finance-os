/**
 * One-time, idempotent migration for the "unify to one amount" change.
 *
 * Envelope categories (tracked + monthlyBudget set) now own their monthly amount in
 * Budgets & sinking funds — generateMonth builds their line + budget from the Category.
 * Their old duplicate "monthly share" RecurringItem lines are therefore redundant and
 * would only clutter Setup. This deletes them.
 *
 * Safe: RecurringItem is a template; ExpenseEntry has no FK to it, so already-generated
 * sheet lines (past/current months, the draft) are untouched. Run again → nothing to do.
 *
 * Usage:  set -a && source .env.local && set +a && npx tsx scripts/unify-budget-items.ts
 */
import { prisma } from "@/lib/prisma";

async function main() {
  const households = await prisma.household.findMany({ select: { id: true } });
  let totalDeleted = 0;

  for (const h of households) {
    const cats = await prisma.category.findMany({
      where: { householdId: h.id },
      select: { id: true, name: true, tracked: true, monthlyBudget: true },
    });
    // envelope categories = tracked + budgeted (onHold irrelevant — a paused envelope
    // still owns its amount on the Category, so its template item is still redundant)
    const envelopeIds = new Set(cats.filter((c) => c.tracked && c.monthlyBudget != null).map((c) => c.id));
    const catById = new Map(cats.map((c) => [c.id, c]));

    const items = await prisma.recurringItem.findMany({
      where: { householdId: h.id, kind: "expense" },
      select: { id: true, name: true, amount: true, categoryId: true },
    });
    const dupes = items.filter((it) => it.categoryId != null && envelopeIds.has(it.categoryId));

    if (dupes.length === 0) {
      console.log(`household ${h.id}: nothing to delete (already unified)`);
      continue;
    }

    console.log(`household ${h.id}: deleting ${dupes.length} duplicate template line(s):`);
    for (const it of dupes) {
      const cat = catById.get(it.categoryId!);
      const flag = it.amount === cat?.monthlyBudget ? "" : `  ⚠ amount ${it.amount} ≠ budget ${cat?.monthlyBudget} (Category budget is the source going forward)`;
      console.log(`   - "${it.name}" (${cat?.name}) amount=${it.amount} budget=${cat?.monthlyBudget}${flag}`);
    }

    const res = await prisma.recurringItem.deleteMany({ where: { id: { in: dupes.map((d) => d.id) } } });
    totalDeleted += res.count;
    console.log(`   → deleted ${res.count}`);
  }

  console.log(`\nDone. Total deleted: ${totalDeleted}`);
}

main().finally(() => process.exit(0));
