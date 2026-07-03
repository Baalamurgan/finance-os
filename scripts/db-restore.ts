// DESTRUCTIVE: wipe the DB and restore it exactly from a snapshot JSON made by
// db:backup. Use this to revert a bad wind-down (or any mistake).
//   npm run db:restore -- backups/snapshot-<stamp>.json CONFIRM
// The literal word CONFIRM is required so this can never run by accident.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertDbWipeAllowed } from "./guard";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  assertDbWipeAllowed("db:restore");
  const file = process.argv[2];
  const confirm = process.argv[3];
  if (!file || confirm !== "CONFIRM") {
    console.error('Usage: npm run db:restore -- <snapshot.json> CONFIRM');
    process.exit(1);
  }
  // Revive ISO timestamp strings (createdAt, closedAt, settledAt, …) back to
  // Date objects so Prisma accepts them on insert.
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  const d = JSON.parse(readFileSync(file, "utf8"), (_k, v) =>
    typeof v === "string" && ISO.test(v) ? new Date(v) : v,
  );

  await prisma.$transaction(async (tx) => {
    // delete children → parents
    await tx.loanPayment.deleteMany();
    await tx.loan.deleteMany();
    await tx.settlementRecord.deleteMany();
    await tx.piggyEntry.deleteMany();
    await tx.spend.deleteMany();
    await tx.budget.deleteMany();
    await tx.expenseEntry.deleteMany();
    await tx.incomeEntry.deleteMany();
    await tx.period.deleteMany();
    await tx.category.deleteMany();
    await tx.member.deleteMany();
    await tx.household.deleteMany();

    // recreate parents → children, preserving original ids
    if (d.household?.length) await tx.household.createMany({ data: d.household });
    if (d.member?.length) await tx.member.createMany({ data: d.member });
    if (d.category?.length) await tx.category.createMany({ data: d.category });
    if (d.period?.length) await tx.period.createMany({ data: d.period });
    if (d.incomeEntry?.length) await tx.incomeEntry.createMany({ data: d.incomeEntry });
    if (d.expenseEntry?.length) await tx.expenseEntry.createMany({ data: d.expenseEntry });
    if (d.budget?.length) await tx.budget.createMany({ data: d.budget });
    if (d.spend?.length) await tx.spend.createMany({ data: d.spend });
    if (d.piggyEntry?.length) await tx.piggyEntry.createMany({ data: d.piggyEntry });
    if (d.settlementRecord?.length) await tx.settlementRecord.createMany({ data: d.settlementRecord });
    if (d.loan?.length) await tx.loan.createMany({ data: d.loan });
    if (d.loanPayment?.length) await tx.loanPayment.createMany({ data: d.loanPayment });
  });

  console.log(`✓ Restored from ${file} (taken ${d._meta?.takenAt ?? "?"}).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
