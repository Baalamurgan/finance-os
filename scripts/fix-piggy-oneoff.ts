// One-off cleanup for pre-fix "Use Piggy" artifacts. NON-DESTRUCTIVE: it only
// flips oneOff=true so these stop cloning into future months. It never deletes —
// any expense you edited into a real expense is kept exactly as-is.
//   1. every "From Piggy: …" income → oneOff=true
//   2. its paired auto-expense (same period, label == the note) → oneOff=true
// Idempotent: rerunning changes nothing.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const piggyIncomes = await prisma.incomeEntry.findMany({
    where: { source: { startsWith: "From Piggy:" } },
    select: { id: true, periodId: true, source: true, amount: true, oneOff: true },
  });

  let incomeFixed = 0;
  let expenseFixed = 0;

  for (const inc of piggyIncomes) {
    if (!inc.oneOff) {
      await prisma.incomeEntry.update({ where: { id: inc.id }, data: { oneOff: true } });
      console.log(`income  #${inc.id} "${inc.source}" ₹${inc.amount} → oneOff=true`);
      incomeFixed++;
    }
    // paired auto-expense: same period, label == the note (amount may have been edited)
    const note = inc.source.replace(/^From Piggy:\s*/, "");
    const paired = await prisma.expenseEntry.findMany({
      where: { periodId: inc.periodId, label: note, oneOff: false },
      select: { id: true, amount: true, label: true },
    });
    for (const e of paired) {
      await prisma.expenseEntry.update({ where: { id: e.id }, data: { oneOff: true } });
      console.log(`expense #${e.id} "${e.label}" ₹${e.amount} → oneOff=true (kept, won't recur)`);
      expenseFixed++;
    }
  }

  console.log(`\nDone. incomes fixed: ${incomeFixed}, expenses fixed: ${expenseFixed}.`);
}

main().finally(() => prisma.$disconnect());
