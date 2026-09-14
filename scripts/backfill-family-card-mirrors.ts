import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// WRITE (idempotent). Backfills the card-ledger mirror for family spends that were paid with a family
// card (credit OR debit) BEFORE the mirror feature existed. For each such Spend with no mirror yet, it
// creates the linked AccountTransaction on the card OWNER's account (same as doAddSpend does going
// forward). Safe to re-run — spends that already have a mirror are skipped.
//
// Run AFTER applying migration 20260914_family_credit_mirror:
//   node_modules/.bin/tsx scripts/backfill-family-card-mirrors.ts
// Dry run (no writes), just report what it would do:
//   node_modules/.bin/tsx scripts/backfill-family-card-mirrors.ts --dry
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const DRY = process.argv.includes("--dry");

async function main() {
  // Family spends on any card (credit or debit) that don't yet have a mirror line.
  const spends = await prisma.spend.findMany({
    where: {
      cardAccountId: { not: null },
      mirrorTxn: { is: null },
    },
    select: {
      id: true, amount: true, label: true, createdAt: true, cardAccountId: true,
      cardAccount: { select: { memberId: true, name: true, member: { select: { name: true } } } },
      category: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (spends.length === 0) {
    console.log("Nothing to backfill — every family credit-card spend already has a mirror.");
    return;
  }

  console.log(`${DRY ? "[DRY] " : ""}Backfilling ${spends.length} mirror line(s):`);
  let done = 0;
  for (const s of spends) {
    const owner = s.cardAccount!.memberId;
    console.log(
      `  • spend #${s.id} "${s.label}" ₹${s.amount} → ${s.cardAccount!.member.name}'s ${s.cardAccount!.name} (${s.createdAt.toISOString().slice(0, 10)})`,
    );
    if (DRY) continue;
    await prisma.accountTransaction.create({
      data: {
        memberId: owner,
        accountId: s.cardAccountId!,
        date: s.createdAt,
        merchant: s.label,
        amount: s.amount,
        type: "spend",
        category: s.category?.name ?? null,
        source: "family",
        familySpendId: s.id,
      },
    });
    done++;
  }
  console.log(DRY ? "[DRY] No writes made." : `Done — created ${done} mirror line(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
