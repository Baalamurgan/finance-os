// READ-ONLY full-database snapshot to a timestamped JSON file under ./backups/.
// Safe to run anytime; writes nothing to the DB. Pair with db:restore to revert.
//   npm run db:backup
import { config } from "dotenv";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// ENV_FILE=<file> → snapshot exactly that DB (e.g. the prod env file); default = .env.local then .env.
if (process.env.ENV_FILE) config({ path: resolve(__dirname, "..", process.env.ENV_FILE) });
else { config({ path: resolve(__dirname, "..", ".env.local") }); config({ path: resolve(__dirname, "..", ".env") }); }

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  // Order is FK-safe for restore (parents first). Covers EVERY table so a restore
  // is complete — personal tables cascade off Member, so omitting them would lose
  // that data on restore. Keep this in sync when new models are added.
  // Raw `SELECT *` per table (not the Prisma model): the snapshot holds exactly the columns THIS database has,
  // so it works against a prod that hasn't run a newer migration yet (the generated client may know columns
  // the DB doesn't). A table the DB doesn't have yet is skipped as [].
  const TABLES = [
    "household",
    "member",
    "category",
    "period",
    "incomeEntry",
    "expenseEntry",
    "budget",
    "spend",
    "spendRefund",
    "piggyEntry",
    "settlementRecord",
    "loan",
    "loanPayment",
    "activityLog",
    "webAuthnCredential",
    "personalCategory",
    "personalPeriod",
    "personalIncome",
    "personalExpense",
    "personalSpend",
    "personalLoan",
    "financeAccount",
    "creditCardDetail",
    "accountTransaction",
    "netWorthItem",
    "setAsideSkip",
    "billPayment",
    "recurringItem",
    "miscCategory",
    "advance",
    "poolHandover",
    "manualPlanStep",
    "hiddenPlanStep",
    "stepDayOverride",
    "stepOrderOverride",
    "spendKeyword",
    "spendShortcut",
    "integration",
    "personalSavings",
    "personalCardBill",
    "personalPlanItem",
    "personalPlanStep",
    "personalTemplate",
    "netWorthEntry",
    "netWorthSnapshot",
  ];
  const data: Record<string, unknown> = { _meta: { takenAt: new Date().toISOString() } };
  for (const key of TABLES) {
    const table = key.charAt(0).toUpperCase() + key.slice(1);
    data[key] = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY id`).catch(() => []);
  }

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
