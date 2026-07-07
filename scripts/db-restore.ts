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

  // WebAuthnCredential.publicKey is Bytes. Depending on the driver, JSON stores it
  // either as {type:"Buffer",data:[…]} or as a Uint8Array-style {"0":.., "1":..}.
  const toBuffer = (pk: unknown): unknown => {
    if (pk == null || Buffer.isBuffer(pk)) return pk;
    const o = pk as { type?: string; data?: number[] };
    if (o.type === "Buffer" && Array.isArray(o.data)) return Buffer.from(o.data);
    if (typeof pk === "object") return Buffer.from(Object.values(pk as Record<string, number>));
    return pk;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reviveBytes = (rows: any[] = []): any[] =>
    rows.map((r) => ({ ...r, publicKey: toBuffer(r.publicKey) }));

  await prisma.$transaction(async (tx) => {
    // delete children → parents (personal/webauthn also cascade off Member, but be explicit)
    await tx.accountTransaction.deleteMany();
    await tx.creditCardDetail.deleteMany();
    await tx.financeAccount.deleteMany();
    await tx.personalSpend.deleteMany();
    await tx.personalExpense.deleteMany();
    await tx.personalIncome.deleteMany();
    await tx.personalLoan.deleteMany();
    await tx.personalPeriod.deleteMany();
    await tx.personalCategory.deleteMany();
    await tx.webAuthnCredential.deleteMany();
    await tx.activityLog.deleteMany();
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
    if (d.activityLog?.length) await tx.activityLog.createMany({ data: d.activityLog });
    if (d.webAuthnCredential?.length) await tx.webAuthnCredential.createMany({ data: reviveBytes(d.webAuthnCredential) });
    if (d.personalCategory?.length) await tx.personalCategory.createMany({ data: d.personalCategory });
    if (d.personalPeriod?.length) await tx.personalPeriod.createMany({ data: d.personalPeriod });
    if (d.personalIncome?.length) await tx.personalIncome.createMany({ data: d.personalIncome });
    if (d.personalExpense?.length) await tx.personalExpense.createMany({ data: d.personalExpense });
    if (d.personalSpend?.length) await tx.personalSpend.createMany({ data: d.personalSpend });
    if (d.personalLoan?.length) await tx.personalLoan.createMany({ data: d.personalLoan });
    if (d.financeAccount?.length) await tx.financeAccount.createMany({ data: d.financeAccount });
    if (d.creditCardDetail?.length) await tx.creditCardDetail.createMany({ data: d.creditCardDetail });
    if (d.accountTransaction?.length) await tx.accountTransaction.createMany({ data: d.accountTransaction });
  });

  // Restored rows keep their original ids, so bump each id sequence past the max
  // (else the next insert collides on the primary key).
  const tables = [
    "Household", "Member", "Category", "Period", "IncomeEntry", "ExpenseEntry", "Budget",
    "Spend", "PiggyEntry", "SettlementRecord", "Loan", "LoanPayment", "ActivityLog",
    "WebAuthnCredential", "PersonalCategory", "PersonalPeriod", "PersonalIncome",
    "PersonalExpense", "PersonalSpend", "PersonalLoan", "PersonalCard", "PersonalCardTxn",
  ];
  for (const t of tables) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), (SELECT COALESCE(MAX(id), 0) FROM "${t}") + 1, false)`,
    );
  }

  console.log(`✓ Restored from ${file} (taken ${d._meta?.takenAt ?? "?"}) + sequences reset.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
