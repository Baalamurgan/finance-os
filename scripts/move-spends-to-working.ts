import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Moves daily SPENDS that landed in a prematurely-promoted month back to the working month (the
// EARLIEST still-open month) for each household. Touches ONLY the Spend table — never bills,
// settlements or paid flags. DRY RUN unless run with `--apply`.
//   npx tsx scripts/move-spends-to-working.ts          (preview)
//   npx tsx scripts/move-spends-to-working.ts --apply  (do it)
const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function main() {
  console.log(APPLY ? "APPLYING changes\n" : "DRY RUN (pass --apply to commit)\n");
  const households = await prisma.household.findMany({ select: { id: true, name: true } });
  for (const h of households) {
    const open = await prisma.period.findMany({ where: { householdId: h.id, status: "open" }, orderBy: [{ year: "asc" }, { month: "asc" }], select: { id: true, label: true } });
    if (open.length <= 1) continue;
    const working = open[0]; // earliest open = the month you're still living in
    const stray = open.slice(1); // prematurely-promoted later open month(s)
    for (const p of stray) {
      const spends = await prisma.spend.findMany({ where: { periodId: p.id }, select: { id: true, label: true, amount: true } });
      if (spends.length === 0) { console.log(`${h.name}: ${p.label} → no spends to move`); continue; }
      const total = spends.reduce((s, x) => s + x.amount, 0);
      console.log(`${h.name}: move ${spends.length} spend(s) totalling ${inr(total)} from ${p.label} → ${working.label}`);
      for (const s of spends) console.log(`   ${inr(s.amount)}  "${s.label}"`);
      if (APPLY) {
        const r = await prisma.spend.updateMany({ where: { periodId: p.id }, data: { periodId: working.id } });
        console.log(`   ✓ moved ${r.count}`);
      }
    }
  }
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
