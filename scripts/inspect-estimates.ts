import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// READ-ONLY. Dumps every period + its surplus/carry ESTIMATE lines and spend/expense counts, so we
// can see exactly which months carry an estimate and from where. Run: npx tsx scripts/inspect-estimates.ts
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function main() {
  const households = await prisma.household.findMany({ select: { id: true, name: true } });
  for (const h of households) {
    const periods = await prisma.period.findMany({ where: { householdId: h.id }, orderBy: [{ year: "asc" }, { month: "asc" }], select: { id: true, label: true, status: true, carryForward: true } });
    console.log(`\n=== ${h.name} (household ${h.id}) ===`);
    for (const p of periods) {
      const [surplus, carry, spendCount, spendSum, expCount] = await Promise.all([
        prisma.incomeEntry.findMany({ where: { periodId: p.id, note: "__surplus__" }, select: { source: true, amount: true } }),
        prisma.expenseEntry.findMany({ where: { periodId: p.id, note: "__carry__" }, select: { label: true, amount: true } }),
        prisma.spend.count({ where: { periodId: p.id } }),
        prisma.spend.aggregate({ where: { periodId: p.id }, _sum: { amount: true } }),
        prisma.expenseEntry.count({ where: { periodId: p.id } }),
      ]);
      console.log(`\n  ${p.status.padEnd(6)} ${p.label} (id ${p.id}) carryFwd=${inr(p.carryForward)} · spends=${spendCount}/${inr(spendSum._sum.amount ?? 0)} · expenseRows=${expCount}`);
      for (const s of surplus) console.log(`     SURPLUS line: "${s.source}" = ${inr(s.amount)}`);
      for (const c of carry) console.log(`     CARRY line: "${c.label}" = ${inr(c.amount)}`);
    }
  }
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
