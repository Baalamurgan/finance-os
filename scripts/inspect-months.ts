import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// READ-ONLY. Shows each household's periods (id/label/status) and, for any OPEN month that is not
// the earliest open one, lists its activity (spends / settlements / piggy moves / paid bills) so a
// prematurely-promoted month can be cleaned up safely. Run: npx tsx scripts/inspect-months.ts
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function main() {
  const households = await prisma.household.findMany({ select: { id: true, name: true } });
  for (const h of households) {
    const periods = await prisma.period.findMany({ where: { householdId: h.id }, orderBy: [{ year: "asc" }, { month: "asc" }], select: { id: true, label: true, status: true } });
    console.log(`\n=== ${h.name} (household ${h.id}) ===`);
    for (const p of periods) console.log(`  ${p.status.padEnd(6)} ${p.label}  (id ${p.id})`);

    const open = periods.filter((p) => p.status === "open");
    if (open.length <= 1) { console.log("  → single open month, nothing to reconcile"); continue; }
    // earliest open = the working month; the rest are the prematurely-promoted ones
    for (const p of open.slice(1)) {
      const [spends, settle, piggy, paidBills] = await Promise.all([
        prisma.spend.findMany({ where: { periodId: p.id }, select: { label: true, amount: true, categoryId: true, member: { select: { name: true } } } }),
        prisma.settlementRecord.count({ where: { periodId: p.id } }),
        prisma.piggyEntry.count({ where: { periodId: p.id } }),
        prisma.expenseEntry.count({ where: { periodId: p.id, paid: true } }),
      ]);
      console.log(`\n  --- activity in ${p.label} (id ${p.id}) that would move to the working month ---`);
      console.log(`  spends: ${spends.length} · settlementRecords: ${settle} · piggyEntries: ${piggy} · bills marked paid: ${paidBills}`);
      for (const s of spends) console.log(`     spend: ${inr(s.amount)}  "${s.label}"  by ${s.member?.name ?? "—"} (cat ${s.categoryId})`);
    }
  }
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
