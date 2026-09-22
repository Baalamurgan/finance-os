/**
 * ONE-OFF WRITE (you run this): move the AUGUST fuel spend off the RBL card so the Oct-3 bill reflects
 * only September's spend (₹9,804 → ₹6,417). It marks the family Spend as CASH (cardAccountId → null) and
 * removes its RBL mirror line — exactly how June/July fuel is already handled. September is untouched.
 *
 * From diagnose-rbl-aug-mirror.ts: Spend #226 ("Brio Petrol", ₹3,387, AUG, cat Fuel, card RBL #7) and its
 * mirror AccountTransaction #31. The script VERIFIES both before writing and refuses on any mismatch.
 *
 * Why it's safe (no change to the In-Hand you see now): the bill is due 3 Oct, so it isn't in SEP's
 * In-Hand at all — this only lowers the bill and October's "held for the bill" line.
 *
 * Dry run:  node_modules/.bin/tsx scripts/fix-rbl-aug-to-cash.ts
 * Apply:    node_modules/.bin/tsx scripts/fix-rbl-aug-to-cash.ts --apply
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "..", ".env.local") });
config({ path: resolve(__dirname, "..", ".env") });
const url = process.env.DATABASE_URL ?? "";
if (!url || !/^postgres/i.test(url)) { console.error("✗ DATABASE_URL missing. Run: vercel env pull .env.local"); process.exit(1); }
const APPLY = process.argv.includes("--apply");
const SPEND_ID = 226;
const MIRROR_ID = 31;
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const spend = await prisma.spend.findUnique({
      where: { id: SPEND_ID },
      select: { id: true, label: true, amount: true, cardAccountId: true, category: { select: { name: true } }, period: { select: { label: true, status: true } } },
    });
    const mirror = await prisma.accountTransaction.findUnique({
      where: { id: MIRROR_ID },
      select: { id: true, merchant: true, amount: true, accountId: true, source: true, familySpendId: true },
    });
    console.log("Spend  :", spend ? `#${spend.id} "${spend.label}" ${inr(spend.amount)} · ${spend.period.label}[${spend.period.status}] · cat=${spend.category.name} · card=${spend.cardAccountId}` : "(not found)");
    console.log("Mirror :", mirror ? `AT#${mirror.id} "${mirror.merchant}" ${inr(mirror.amount)} · account=${mirror.accountId} · source=${mirror.source} · familySpendId=${mirror.familySpendId}` : "(not found — maybe already removed)");

    // Verify before touching anything.
    const bad: string[] = [];
    if (!spend) bad.push(`Spend #${SPEND_ID} not found`);
    else {
      if (spend.cardAccountId == null) bad.push("Spend is already cash (cardAccountId is null) — nothing to do");
      if (!/fuel/i.test(spend.category.name)) bad.push(`Spend category is "${spend.category.name}", expected Fuel`);
      if (Math.abs(spend.amount - 3387) > 0.5) bad.push(`Spend amount ${inr(spend.amount)} ≠ ₹3,387`);
    }
    if (mirror && mirror.familySpendId !== SPEND_ID) bad.push(`Mirror AT#${MIRROR_ID} links Spend #${mirror.familySpendId}, not #${SPEND_ID}`);
    if (bad.length) { console.error(`\n✗ Refusing to write:\n   - ${bad.join("\n   - ")}`); return; }

    if (!APPLY) { console.log("\n(dry run) Re-run with --apply to mark it cash + drop the RBL mirror. Then the Oct-3 bill = ₹6,417.\n"); return; }

    await prisma.$transaction(async (tx) => {
      await tx.spend.update({ where: { id: SPEND_ID }, data: { cardAccountId: null } }); // → cash/UPI, like June/July
      if (mirror) await tx.accountTransaction.delete({ where: { id: MIRROR_ID } });       // off the RBL card ledger/bill
    });
    console.log(`\n✓ Spend #${SPEND_ID} is now cash; RBL mirror ${mirror ? `AT#${MIRROR_ID} removed` : "already absent"}.`);
    console.log("→ RBL Oct-3 bill is now ₹6,417 (September only). Pay the real ₹9,804 offline; the ₹3,387 was set aside in personal.\n");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
