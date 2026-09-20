/**
 * ONE-OFF WRITE (you run this, AFTER applying migration 20260921_card_reimbursed): flag the Pluxee card
 * as "reimbursed at settlement" so its spends are excluded from In-Hand and shown as "settles next month".
 * Matches by card name containing "Pluxee". Idempotent. Safe: refuses if 0 or >1 matches.
 *
 * Dry run:  node_modules/.bin/tsx scripts/set-pluxee-reimbursed.ts
 * Apply:    node_modules/.bin/tsx scripts/set-pluxee-reimbursed.ts --apply
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "..", ".env.local") });
config({ path: resolve(__dirname, "..", ".env") });
const url = process.env.DATABASE_URL ?? "";
if (!url || !/^postgres/i.test(url)) { console.error("✗ DATABASE_URL missing. Run: vercel env pull .env.local"); process.exit(1); }
const APPLY = process.argv.includes("--apply");

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const cards = await prisma.financeAccount.findMany({
      where: { name: { contains: "Pluxee", mode: "insensitive" } },
      select: { id: true, name: true, type: true, reimbursed: true, member: { select: { name: true } } },
    });
    if (cards.length === 0) { console.error("✗ No card whose name contains 'Pluxee'."); return; }
    if (cards.length > 1) {
      console.error(`✗ ${cards.length} matches — too ambiguous. Rows:`);
      for (const c of cards) console.log(`   #${c.id} "${c.name}" (${c.type}, owner ${c.member?.name}) reimbursed=${c.reimbursed}`);
      return;
    }
    const c = cards[0];
    console.log(`Pluxee card: #${c.id} "${c.name}" · ${c.type} · owner ${c.member?.name} · reimbursed currently = ${c.reimbursed}`);
    if (c.reimbursed) { console.log("Already reimbursed=true — nothing to do."); return; }
    if (!APPLY) { console.log("\n(dry run) Re-run with --apply to set reimbursed=true.\n"); return; }
    await prisma.financeAccount.update({ where: { id: c.id }, data: { reimbursed: true } });
    console.log("\n✓ Set reimbursed=true. Bust the cache — Pluxee spends now settle next month (not in In-Hand).\n");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
