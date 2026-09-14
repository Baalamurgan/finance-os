import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// WRITE (idempotent). Backfills the card-ledger mirror for PERSONAL spends already tagged to a card
// (before this feature they were tags only). For each PersonalSpend with a cardAccountId and no ledger
// line yet, it posts the linked AccountTransaction on that card — so the spend shows as a line item
// under the card (and drives balance for debit/prepaid, outstanding for credit). This is additive and
// does NOT touch the month's spendable / cash-in-hand / dues (those still run through the card tag).
//
// Run AFTER migration 20260915_card_balances:
//   node_modules/.bin/tsx scripts/backfill-personal-card-ledger.ts
// Dry run:
//   node_modules/.bin/tsx scripts/backfill-personal-card-ledger.ts --dry
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const DRY = process.argv.includes("--dry");

async function main() {
  const spends = await prisma.personalSpend.findMany({
    where: { cardAccountId: { not: null }, ledgerTxn: { is: null } },
    select: {
      id: true, memberId: true, cardAccountId: true, amount: true, note: true, date: true,
      category: { select: { name: true } },
      cardAccount: { select: { name: true, type: true } },
    },
    orderBy: { date: "asc" },
  });

  if (spends.length === 0) {
    console.log("Nothing to backfill — every card-tagged personal spend already has a ledger line.");
    return;
  }

  console.log(`${DRY ? "[DRY] " : ""}Backfilling ${spends.length} personal ledger line(s):`);
  let done = 0;
  for (const s of spends) {
    const label = s.note?.trim() || s.category?.name || "Spend";
    console.log(`  • personalSpend #${s.id} "${label}" ₹${s.amount} → ${s.cardAccount?.name} (${s.cardAccount?.type}) ${s.date.toISOString().slice(0, 10)}`);
    if (DRY) continue;
    await prisma.accountTransaction.create({
      data: {
        memberId: s.memberId,
        accountId: s.cardAccountId!,
        date: s.date,
        merchant: label,
        amount: s.amount,
        type: "spend",
        category: s.category?.name ?? null,
        source: "personal",
        personalSpendId: s.id,
      },
    });
    done++;
  }
  console.log(DRY ? "[DRY] No writes made." : `Done — created ${done} ledger line(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
