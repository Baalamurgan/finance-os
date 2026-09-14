/**
 * Backfill PersonalLoan.spendId for split/reimbursement receivables created before the
 * link column existed. Matches each shared-spend loan (sharedPaid != null, spendId null)
 * to the PersonalSpend it came from by member + note + amount(==sharedPaid), preferring the
 * spend created closest in time. Idempotent: only fills nulls, re-runnable.
 *
 * Run locally against prod (read+write): node_modules/.bin/tsx scripts/backfill-split-spend-links.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const loans = await prisma.personalLoan.findMany({
    where: { sharedPaid: { not: null }, spendId: null },
    orderBy: { id: "asc" },
  });
  console.log(`Found ${loans.length} unlinked shared-spend receivable(s).`);

  let linked = 0, skipped = 0;
  for (const loan of loans) {
    const paid = loan.sharedPaid ?? 0;
    // candidate spends: same member, is a shared spend, same note, amount == the full paid
    const candidates = await prisma.personalSpend.findMany({
      where: {
        memberId: loan.memberId,
        sharedOthers: { not: null },
        note: loan.note,
        amount: { gte: paid - 0.01, lte: paid + 0.01 },
      },
    });
    if (candidates.length === 0) { skipped++; console.log(`  · loan #${loan.id} (${loan.counterparty}, ₹${paid}) — no matching spend, skipped`); continue; }
    // nearest createdAt to the loan
    const best = candidates.sort(
      (a, b) => Math.abs(a.createdAt.getTime() - loan.createdAt.getTime()) - Math.abs(b.createdAt.getTime() - loan.createdAt.getTime()),
    )[0];
    await prisma.personalLoan.update({ where: { id: loan.id }, data: { spendId: best.id } });
    linked++;
    console.log(`  ✓ loan #${loan.id} → spend #${best.id} ("${best.note}")`);
  }
  console.log(`\nLinked ${linked}, skipped ${skipped}.`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
