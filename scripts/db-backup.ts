// READ-ONLY full-database snapshot to a timestamped JSON file under ./backups/.
// Safe to run anytime; writes nothing to the DB. Pair with db:restore to revert.
//   npm run db:backup
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  // Order is FK-safe for restore (parents first).
  const data = {
    _meta: { takenAt: new Date().toISOString() },
    household: await prisma.household.findMany(),
    member: await prisma.member.findMany(),
    category: await prisma.category.findMany(),
    period: await prisma.period.findMany(),
    incomeEntry: await prisma.incomeEntry.findMany(),
    expenseEntry: await prisma.expenseEntry.findMany(),
    budget: await prisma.budget.findMany(),
    spend: await prisma.spend.findMany(),
    piggyEntry: await prisma.piggyEntry.findMany(),
    settlementRecord: await prisma.settlementRecord.findMany(),
    loan: await prisma.loan.findMany(),
    loanPayment: await prisma.loanPayment.findMany(),
  };

  mkdirSync("backups", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `backups/snapshot-${stamp}.json`;
  writeFileSync(file, JSON.stringify(data, null, 2));

  const counts = Object.entries(data)
    .filter(([k]) => k !== "_meta")
    .map(([k, v]) => `${k}=${(v as unknown[]).length}`)
    .join("  ");
  console.log(`✓ Backup written: ${file}`);
  console.log(`  ${counts}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
