/**
 * ONE-OFF WRITE (you run this, AFTER applying migration 20260923_misc_card_repeat_monthly):
 * merge the two G704 maintenance entries into ONE monthly-recurring spend card.
 *
 * Today G704 exists twice: (a) RecurringItem "G704 maintenance charges" in the Personal/Misc category
 * (a plain recurring line) and (b) the "G704 maintenance charges" spend-card category. This makes the
 * spend-card repeat EVERY month (repeatMonthly=true) and deletes the redundant recurring line — leaving
 * ONE entry that both repeats monthly and is a variable budget you log spends into.
 *
 * After running: rebuild the preview month (Setup → "Plan next month" / the ↻ rebuild) so the leftover
 * duplicate line clears. September is untouched. Idempotent; refuses on anything ambiguous.
 *
 * Dry run:  node_modules/.bin/tsx scripts/merge-g704-spendcard.ts
 * Apply:    node_modules/.bin/tsx scripts/merge-g704-spendcard.ts --apply
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "..", ".env.local") });
config({ path: resolve(__dirname, "..", ".env") });

const url = process.env.DATABASE_URL ?? "";
if (!url || !/^postgres/i.test(url)) { console.error("✗ DATABASE_URL missing/invalid. Run: vercel env pull .env.local"); process.exit(1); }
const APPLY = process.argv.includes("--apply");

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    // (a) the spend-card category — make it repeat monthly
    const cards = await prisma.category.findMany({
      where: { miscCard: true, name: { contains: "G704 mainten", mode: "insensitive" } },
      select: { id: true, name: true, repeatMonthly: true, repeatYearly: true, monthlyBudget: true },
    });
    if (cards.length !== 1) { console.error(`✗ Expected exactly 1 G704 spend-card category, found ${cards.length}.`); cards.forEach((c) => console.log(`   #${c.id} "${c.name}"`)); return; }
    const card = cards[0];

    // (b) the redundant recurring line (RecurringItem) for G704 maintenance
    const items = await prisma.recurringItem.findMany({
      where: { kind: "expense", name: { contains: "G704 mainten", mode: "insensitive" } },
      select: { id: true, name: true, amount: true, categoryId: true },
    });
    const catNames = new Map((await prisma.category.findMany({ where: { id: { in: items.map((i) => i.categoryId ?? 0) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));

    console.log(`Spend-card category: #${card.id} "${card.name}" · budget ${card.monthlyBudget} · repeatMonthly=${card.repeatMonthly} repeatYearly=${card.repeatYearly}`);
    console.log(`Recurring line(s) to delete: ${items.length === 0 ? "(none)" : ""}`);
    for (const it of items) console.log(`   RecurringItem #${it.id} "${it.name}" ₹${it.amount} in category "${it.categoryId != null ? catNames.get(it.categoryId) : "-"}"`);

    if (!APPLY) { console.log("\n(dry run) Re-run with --apply. Then rebuild the preview month.\n"); return; }

    await prisma.$transaction(async (tx) => {
      await tx.category.update({ where: { id: card.id }, data: { repeatMonthly: true, repeatYearly: false, billMonth: null } });
      if (items.length) await tx.recurringItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
    });
    console.log(`\n✓ "${card.name}" now repeats monthly; deleted ${items.length} recurring line(s).`);
    console.log("→ Now rebuild the preview month so the leftover duplicate line clears.\n");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
