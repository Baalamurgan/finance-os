import { prisma } from "@/lib/prisma";
import { buildAllocation } from "@/lib/allocation";
import { planWindDown, type CutTarget, type PlanRow, type SavedChoice } from "@/lib/windDownPlan";

type Db = Pick<typeof prisma, "budget" | "expenseEntry" | "spend" | "category" | "windDownChoice">;

// Gather one month's wind-down inputs (budgeted categories with what was spent, next month's regular
// budgets that can take a cut, and the saved groups) and run the planner. Works inside a transaction.
export async function loadWindDownPlan(db: Db, period: { id: number; householdId: number }) {
  const { id: periodId, householdId } = period;
  const [budgets, miscEnv, spends, cats, choiceRows] = await Promise.all([
    db.budget.findMany({ where: { periodId }, select: { categoryId: true, planned: true } }),
    db.expenseEntry.findMany({ where: { periodId, note: null, category: { householdId, tracked: true, miscCard: true } }, select: { categoryId: true, amount: true } }),
    db.spend.findMany({ where: { periodId }, select: { categoryId: true, amount: true } }),
    db.category.findMany({
      where: { householdId, tracked: true, onHold: false, sinking: false, kind: "expense" },
      select: { id: true, name: true, miscCard: true, monthlyBudget: true, responsibleMemberId: true, fundingStyle: true },
      orderBy: { name: "asc" },
    }),
    db.windDownChoice.findMany({ where: { periodId }, orderBy: { id: "asc" } }),
  ]);
  const alloc = buildAllocation(budgets, miscEnv);
  const spentBy = new Map<number, number>();
  for (const s of spends) spentBy.set(s.categoryId, (spentBy.get(s.categoryId) ?? 0) + s.amount);

  const rows: PlanRow[] = cats
    .filter((c) => c.fundingStyle == null && (alloc.get(c.id) ?? 0) > 0)
    .map((c) => ({
      categoryId: c.id, name: c.name, planned: c.miscCard,
      budget: Math.round((alloc.get(c.id) ?? 0) * 100) / 100,
      spent: Math.round((spentBy.get(c.id) ?? 0) * 100) / 100,
      holderId: c.responsibleMemberId,
    }));
  const targets: CutTarget[] = cats
    .filter((c) => !c.miscCard && c.fundingStyle == null && (c.monthlyBudget ?? 0) > 0)
    .map((c) => ({ categoryId: c.id, name: c.name, capacity: c.monthlyBudget! }));
  const choices: SavedChoice[] = choiceRows.map((r) => ({
    categoryIds: r.categoryIds,
    destination: r.destination === "income" ? "income" : "piggy",
    cuts: Array.isArray(r.cuts) ? (r.cuts as { categoryId: number; amount: number }[]) : null,
  }));
  return { rows, targets, choices, ...planWindDown(rows, targets, choices) };
}
