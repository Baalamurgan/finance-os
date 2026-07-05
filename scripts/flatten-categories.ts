// One-time: flatten the old tracked-budget categories (Petrol, Provision, Non-Veg,
// Veg) into plain monthly expenses (tracked=false). Precisely targets non-sinking
// tracked categories that have a monthly amount — leaves sinking funds and the
// no-budget Misc bucket untouched. Their tagged Sheet lines stay; only the budget/
// Piggy-accrual behaviour is dropped. Idempotent.
//   set -a; source .env.local; set +a; npx tsx scripts/flatten-categories.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const targets = await prisma.category.findMany({
    where: { tracked: true, sinking: false, monthlyBudget: { not: null } },
    select: { id: true, name: true, monthlyBudget: true },
  });
  if (targets.length === 0) {
    console.log("Nothing to flatten (already done).");
    return;
  }
  console.log("Flattening → flat monthly expenses (tracked=false):");
  for (const c of targets) console.log(`  • ${c.name} (₹${c.monthlyBudget})`);
  await prisma.category.updateMany({
    where: { id: { in: targets.map((c) => c.id) } },
    data: { tracked: false },
  });
  console.log(`\n✓ ${targets.length} categories flattened. Their tagged Sheet lines are unchanged.`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
