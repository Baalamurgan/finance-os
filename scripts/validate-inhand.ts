// READ-ONLY: print the new per-member "in my account" for the latest open month —
// every tagged monthly expense counts, misc subtracts. Writes nothing.
//   set -a; source .env.local; set +a; npx tsx scripts/validate-inhand.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

async function main() {
  const period = await prisma.period.findFirst({ where: { status: "open" }, orderBy: [{ year: "desc" }, { month: "desc" }] });
  if (!period) return console.log("no open period");
  const [expenses, spends, members] = await Promise.all([
    prisma.expenseEntry.findMany({ where: { periodId: period.id }, include: { category: true } }),
    prisma.spend.findMany({ where: { periodId: period.id }, include: { category: true } }),
    prisma.member.findMany({ where: { householdId: period.householdId }, orderBy: { id: "asc" } }),
  ]);

  const miscOf = (key: number | null) =>
    spends.filter((s) => (s.memberId ?? null) === key && !s.category?.sinking).reduce((a, s) => a + s.amount, 0);

  console.log(`\n=== "In my account" per member — ${period.label} ===\n`);
  for (const m of [...members, { id: null as number | null, name: "Shared / pool" }]) {
    const lines = expenses.filter((e) => (e.memberId ?? null) === m.id);
    if (lines.length === 0 && miscOf(m.id) === 0) continue;
    const total = lines.reduce((a, e) => a + e.amount, 0);
    const misc = miscOf(m.id);
    console.log(`${m.name}  →  net ${inr(total - misc)}   (expenses ${inr(total)}${misc ? ` − misc ${inr(misc)}` : ""})`);
    for (const e of lines.sort((a, b) => b.amount - a.amount))
      console.log(`   ${e.label.padEnd(30)} ${inr(e.amount).padStart(10)}${e.category?.sinking ? "  [sinking]" : ""}`);
    console.log("");
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
