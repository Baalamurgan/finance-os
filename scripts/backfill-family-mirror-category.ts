/**
 * ONE-OFF WRITE (you run this): repair the `category` on family card-ledger mirrors that lost it.
 *
 * When a family spend was re-tagged to a card via the EDIT UI (not Add-spend), the mirror
 * AccountTransaction was created WITHOUT its category name — so getCardDues counted it as "misc /
 * other" on the card bill instead of "budgeted" (e.g. the RBL Fuel ₹6,417 landing in misc). The code
 * is now fixed for future edits; this backfills existing rows from their linked family Spend's category.
 *
 * Only touches source="family", type="spend" rows linked to a Spend whose current category name differs
 * from the mirror's. Amount/date/owner untouched. Idempotent.
 *
 * Dry run:  node_modules/.bin/tsx scripts/backfill-family-mirror-category.ts
 * Apply:    node_modules/.bin/tsx scripts/backfill-family-mirror-category.ts --apply
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "..", ".env.local") });
config({ path: resolve(__dirname, "..", ".env") });

const url = process.env.DATABASE_URL ?? "";
if (!url || !/^postgres/i.test(url)) { console.error("✗ DATABASE_URL missing/invalid. Run: vercel env pull .env.local"); process.exit(1); }
const APPLY = process.argv.includes("--apply");
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const mirrors = await prisma.accountTransaction.findMany({
      where: { source: "family", type: "spend", familySpendId: { not: null } },
      select: {
        id: true, amount: true, merchant: true, category: true, date: true,
        familySpend: { select: { category: { select: { name: true } } } },
      },
      orderBy: { date: "asc" },
    });
    const fixes = mirrors
      .map((m) => ({ m, want: m.familySpend?.category?.name ?? null }))
      .filter(({ m, want }) => want != null && m.category !== want);

    if (fixes.length === 0) { console.log("Nothing to fix — every family mirror already matches its spend's category. ✓"); return; }

    console.log(`${fixes.length} mirror(s) to repair:\n`);
    for (const { m, want } of fixes) {
      console.log(`  #${m.id}  ${m.date.toISOString().slice(0, 10)}  ${inr(m.amount)}  "${m.merchant}"  category: ${m.category ?? "—"} → ${want}`);
    }

    if (!APPLY) { console.log("\n(dry run) Re-run with --apply to write the categories.\n"); return; }

    let n = 0;
    for (const { m, want } of fixes) {
      await prisma.accountTransaction.update({ where: { id: m.id }, data: { category: want } });
      n++;
    }
    console.log(`\n✓ Repaired ${n} mirror(s). The card bill's budgeted-vs-misc split is now correct.\n`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
