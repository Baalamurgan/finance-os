import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Non-destructive: ensures the *current calendar month* exists as a period for every
// household, cloned from the latest period (income + expense rows + budgets, tags kept).
// Does NOT close or touch any previous month — that stays a manual wind-down.
// Intended to run on the 1st via cron/launchd so the new month is ready to log into.
const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" }),
});

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

async function ensureForHousehold(householdId: number, year: number, month: number) {
  const existing = await prisma.period.findUnique({
    where: { householdId_year_month: { householdId, year, month } },
  });
  if (existing) {
    console.log(`  household ${householdId}: ${MONTHS[month - 1]} ${year} already exists — skip`);
    return;
  }
  const latest = await prisma.period.findFirst({
    where: { householdId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  const label = `${MONTHS[month - 1]} ${year}`;

  await prisma.$transaction(async (tx) => {
    const p = await tx.period.create({ data: { householdId, year, month, label } });
    if (!latest) {
      // first ever month: seed budgets from category templates
      const cats = await tx.category.findMany({
        where: { householdId, monthlyBudget: { not: null }, onHold: false },
      });
      for (const c of cats)
        await tx.budget.create({ data: { periodId: p.id, categoryId: c.id, planned: c.monthlyBudget! } });
      console.log(`  household ${householdId}: created ${label} (fresh, ${cats.length} budgets)`);
      return;
    }
    const [incomes, expenses, heldCats] = await Promise.all([
      tx.incomeEntry.findMany({ where: { periodId: latest.id } }),
      tx.expenseEntry.findMany({ where: { periodId: latest.id } }),
      tx.category.findMany({ where: { householdId, onHold: true }, select: { id: true } }),
    ]);
    const held = new Set(heldCats.map((c) => c.id));
    let inc = 0,
      exp = 0;
    for (const i of incomes) {
      if (i.amount < 0) continue; // skip one-off adjustments
      await tx.incomeEntry.create({
        data: { periodId: p.id, source: i.source, amount: i.amount, ownerId: i.ownerId },
      });
      inc++;
    }
    for (const e of expenses) {
      if (held.has(e.categoryId)) continue;
      await tx.expenseEntry.create({
        data: { periodId: p.id, label: e.label, amount: e.amount, categoryId: e.categoryId, memberId: e.memberId, necessary: e.necessary },
      });
      exp++;
    }
    const cats = await tx.category.findMany({
      where: { householdId, monthlyBudget: { not: null }, onHold: false },
    });
    for (const c of cats)
      await tx.budget.create({ data: { periodId: p.id, categoryId: c.id, planned: c.monthlyBudget! } });
    console.log(`  household ${householdId}: created ${label} — cloned ${inc} income, ${exp} expense, ${cats.length} budgets from ${latest.label}`);
  });
}

async function main() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  console.log(`ensure-month: ${MONTHS[month - 1]} ${year}`);
  const households = await prisma.household.findMany({ select: { id: true } });
  for (const h of households) await ensureForHousehold(h.id, year, month);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("ensure-month failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
