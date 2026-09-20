// READ-ONLY full-database snapshot to a timestamped JSON file under ./backups/.
// Safe to run anytime; writes nothing to the DB. Pair with db:restore to revert.
//   npm run db:backup
import { config } from "dotenv";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

config({ path: resolve(__dirname, "..", ".env.local") });
config({ path: resolve(__dirname, "..", ".env") });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  // Order is FK-safe for restore (parents first). Covers EVERY table so a restore
  // is complete — personal tables cascade off Member, so omitting them would lose
  // that data on restore. Keep this in sync when new models are added.
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
    activityLog: await prisma.activityLog.findMany(),
    webAuthnCredential: await prisma.webAuthnCredential.findMany(),
    personalCategory: await prisma.personalCategory.findMany(),
    personalPeriod: await prisma.personalPeriod.findMany(),
    personalIncome: await prisma.personalIncome.findMany(),
    personalExpense: await prisma.personalExpense.findMany(),
    personalSpend: await prisma.personalSpend.findMany(),
    personalLoan: await prisma.personalLoan.findMany(),
    financeAccount: await prisma.financeAccount.findMany(),
    creditCardDetail: await prisma.creditCardDetail.findMany(),
    accountTransaction: await prisma.accountTransaction.findMany(),
    netWorthItem: await prisma.netWorthItem.findMany(),
    setAsideSkip: await prisma.setAsideSkip.findMany(),
    billPayment: await prisma.billPayment.findMany(),
    // The recurring TEMPLATE is the source of truth every month generates from — omitting it lost the
    // whole schedule on restore. Plus the other tables that were silently missing.
    recurringItem: await prisma.recurringItem.findMany(),
    miscCategory: await prisma.miscCategory.findMany(),
    advance: await prisma.advance.findMany(),
    poolHandover: await prisma.poolHandover.findMany(),
    manualPlanStep: await prisma.manualPlanStep.findMany(),
    hiddenPlanStep: await prisma.hiddenPlanStep.findMany(),
    stepDayOverride: await prisma.stepDayOverride.findMany(),
    stepOrderOverride: await prisma.stepOrderOverride.findMany(),
    spendKeyword: await prisma.spendKeyword.findMany(),
    spendShortcut: await prisma.spendShortcut.findMany(),
    integration: await prisma.integration.findMany(),
    personalSavings: await prisma.personalSavings.findMany(),
    personalCardBill: await prisma.personalCardBill.findMany(),
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
