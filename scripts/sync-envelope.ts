import { config } from "dotenv";
config({ path: ".env.local" }); config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const APPLY = process.argv.includes("--apply");
// One-off: bring generated envelope ExpenseEntry(oneOff:false) amounts in line with their Budget.planned
// for OPEN months (the applyBudgetShortfall fix does this going forward; this fixes already-refreshed months).
async function main() {
  const periods = await prisma.period.findMany({ where: { status: "open" }, select: { id: true, label: true, householdId: true } });
  for (const p of periods) {
    const budgets = await prisma.budget.findMany({ where: { periodId: p.id } });
    const plannedOf = new Map(budgets.map(b => [b.categoryId, b.planned]));
    const envs = await prisma.expenseEntry.findMany({ where: { periodId: p.id, oneOff: false } });
    for (const e of envs) {
      if (e.categoryId == null) continue;
      const planned = plannedOf.get(e.categoryId);
      if (planned == null) continue;
      if (Math.abs(planned - e.amount) < 0.005) continue;
      console.log(`  ${p.label}: envelope #${e.id} "${e.label}" ${e.amount} → ${planned}`);
      if (APPLY) await prisma.expenseEntry.update({ where: { id: e.id }, data: { amount: planned } });
    }
  }
  console.log(APPLY ? "APPLIED" : "(dry-run; pass --apply)");
}
main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
