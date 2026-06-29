import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// READ-ONLY dry-run of a month wind-down. Writes nothing — safe to run anytime.
// Shows exactly what winding down the latest OPEN month would do: piggy/sinking
// deposits, food over-budget excess, misc adjustment, and the carry-forward.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

async function main() {
  const period = await prisma.period.findFirst({
    where: { status: "open" },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  if (!period) {
    console.log("No open period to preview.");
    return;
  }
  const householdId = period.householdId;
  const [incomes, expenses, budgets, spends, trackedCats, members] = await Promise.all([
    prisma.incomeEntry.findMany({ where: { periodId: period.id } }),
    prisma.expenseEntry.findMany({ where: { periodId: period.id } }),
    prisma.budget.findMany({ where: { periodId: period.id } }),
    prisma.spend.findMany({ where: { periodId: period.id } }),
    prisma.category.findMany({ where: { householdId, tracked: true, onHold: false } }),
    prisma.member.findMany({ where: { householdId } }),
  ]);
  const mName = (id: number | null) => (id == null ? "Shared" : members.find((m) => m.id === id)?.name ?? "?");
  const income = incomes.reduce((s, i) => s + i.amount, 0);
  const expense = expenses.reduce((s, e) => s + e.amount, 0);
  const carryOut = period.carryForward + income - expense;
  const budgetOf = (c: number) => budgets.find((b) => b.categoryId === c)?.planned ?? 0;
  const spentOf = (c: number) => spends.filter((s) => s.categoryId === c).reduce((a, s) => a + s.amount, 0);

  const nm = period.month === 12 ? 1 : period.month + 1;
  const ny = period.month === 12 ? period.year + 1 : period.year;

  console.log(`\n=== DRY-RUN: winding down ${period.label}  (read-only, nothing is saved) ===`);
  console.log(`Income ${inr(income)}  −  Expense ${inr(expense)}  =  ${income - expense >= 0 ? "surplus" : "DEFICIT"} ${inr(income - expense)}`);
  console.log(`Carried in ${inr(period.carryForward)}  →  carry to ${MONTHS[nm - 1]} ${ny}: ${inr(carryOut)}${carryOut < 0 ? "  ⚠ next month starts in deficit" : ""}`);

  let piggy = 0, sinking = 0, misc = 0;
  console.log(`\n  Category moves at wind-down:`);
  for (const c of trackedCats) {
    const b = budgetOf(c.id);
    if (b > 0) {
      const rem = b - spentOf(c.id);
      if (rem < 0 && c.responsibleMemberId) {
        console.log(`   • ${c.name}: OVER by ${inr(-rem)} → charged to ${mName(c.responsibleMemberId)} next month`);
      } else if (c.sinking) {
        sinking += rem;
        console.log(`   • ${c.name}: ${inr(rem)} → sinking hold`);
      } else {
        piggy += rem;
        console.log(`   • ${c.name}: ${inr(rem)} → general Piggy`);
      }
    } else {
      const sp = spentOf(c.id);
      if (sp > 0) { misc += sp; console.log(`   • ${c.name} (misc): ${inr(sp)} → deducted from next month income`); }
    }
  }
  console.log(`\n  Totals → general Piggy ${inr(piggy)} · sinking ${inr(sinking)} · misc adjustment −${inr(misc)}`);

  const nextStruct = {
    income: incomes.filter((i) => i.amount >= 0).length,
    expense: expenses.length,
  };
  console.log(`\n  ${MONTHS[nm - 1]} ${ny} will be created: ${nextStruct.income} income + ${nextStruct.expense} expense rows cloned (+ budgets).`);
  console.log(`\n(To actually do this: open /wind-down for ${period.label} and confirm.)\n`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
