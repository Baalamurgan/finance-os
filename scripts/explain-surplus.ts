import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// READ-ONLY. Explains the "Last month surplus (est.)" figure for each household by reproducing
// the exact formula addEstimatedSurplus() uses, and shows where the rest of the month's leftovers
// went (Piggy vs sinking funds) — the buckets that are NOT part of the surplus.
//   carryOut = carryForward + income − expense − overspend
// Run: npx tsx scripts/explain-surplus.ts
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function main() {
  const households = await prisma.household.findMany({ select: { id: true, name: true } });
  for (const h of households) {
    // The source month for the surplus = the current open (working) month.
    const open = await prisma.period.findFirst({
      where: { householdId: h.id, status: "open" },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });
    console.log(`\n=== ${h.name} (household ${h.id}) ===`);
    if (!open) { console.log("  no open month"); continue; }

    const [incomeAgg, expenseAgg, budgets, spends, trackedCats] = await Promise.all([
      prisma.incomeEntry.aggregate({ where: { periodId: open.id }, _sum: { amount: true } }),
      prisma.expenseEntry.aggregate({ where: { periodId: open.id }, _sum: { amount: true } }),
      prisma.budget.findMany({ where: { periodId: open.id } }),
      prisma.spend.findMany({ where: { periodId: open.id } }),
      prisma.category.findMany({ where: { householdId: h.id, tracked: true, onHold: false } }),
    ]);
    const income = incomeAgg._sum.amount ?? 0;
    const expense = expenseAgg._sum.amount ?? 0;
    const spentOf = (c: number) => spends.filter((s) => s.categoryId === c).reduce((t, s) => t + s.amount, 0);
    const budgetOf = (c: number) => budgets.find((b) => b.categoryId === c)?.planned ?? 0;

    let overspend = 0, piggyAccrual = 0, sinkingAccrual = 0;
    const leftoverLines: string[] = [];
    for (const c of trackedCats) {
      const b = budgetOf(c.id);
      if (b <= 0) continue;
      const rem = b - spentOf(c.id);
      if (c.sinking) { sinkingAccrual += rem; }
      else if (rem >= 0) { piggyAccrual += rem; if (rem > 0) leftoverLines.push(`      ${c.name}: budget ${inr(b)} − spent ${inr(spentOf(c.id))} = ${inr(rem)} → Piggy`); }
      else { overspend += -rem; leftoverLines.push(`      ${c.name}: OVER by ${inr(-rem)} (folds into carry)`); }
    }
    const carryOut = open.carryForward + income - expense - overspend;

    console.log(`  Source month: ${open.label} (carryForward in = ${inr(open.carryForward)})`);
    console.log(`  SURPLUS (→ next month income) = carryForward + income − expense − overspend`);
    console.log(`     = ${inr(open.carryForward)} + ${inr(income)} − ${inr(expense)} − ${inr(overspend)}`);
    console.log(`     = ${inr(carryOut)}  ${carryOut > 0 ? "(shown as 'Last month surplus (est.)')" : "(≤0 → no surplus line)"}`);
    console.log(`  Separately, UNSPENT BUDGET → Piggy (NOT surplus): ${inr(piggyAccrual)}`);
    console.log(`  Sinking-fund set-asides this month: ${inr(sinkingAccrual)}`);
    if (leftoverLines.length) { console.log("  Budget leftovers by category:"); leftoverLines.forEach((l) => console.log(l)); }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error("explain-surplus failed:", e); await prisma.$disconnect(); process.exit(1); });
