/**
 * ONE-OFF WRITE (you run this): tag the "Brio Petrol" ₹3,387 fuel spend (23 Aug, Baala) with the RBL
 * card, exactly as the edit-spend UI would — sets cardAccountId + creates the family card-ledger mirror.
 * Amount / category / date / owner are untouched, so the Fuel envelope and settlement don't move; it
 * just joins the RBL billing cycle. Idempotent: re-running does nothing once tagged.
 *
 * Dry run first:   node_modules/.bin/tsx scripts/retag-brio-rbl.ts
 * Apply it:        node_modules/.bin/tsx scripts/retag-brio-rbl.ts --apply
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
    // The RBL card (credit). Narrow by name so we never tag the wrong card.
    const card = await prisma.financeAccount.findFirst({
      where: { type: "credit_card", name: { contains: "RBL", mode: "insensitive" } },
      select: { id: true, name: true, memberId: true },
    });
    if (!card) { console.error("✗ No credit card whose name contains 'RBL'."); return; }
    console.log(`RBL card: #${card.id} "${card.name}" (owner member #${card.memberId})`);

    // The untagged Brio Petrol ₹3,387 spend. Match label + exact amount + no card yet, so we can't hit
    // the already-tagged Brio diesel (₹3,351) or petrol (₹3,066).
    const candidates = await prisma.spend.findMany({
      where: { label: { contains: "Brio", mode: "insensitive" }, amount: 3387, cardAccountId: null },
      include: { category: true, member: { select: { name: true } } },
    });
    if (candidates.length === 0) { console.log("Nothing to do — no untagged Brio ₹3,387 spend found (already tagged?)."); return; }
    if (candidates.length > 1) {
      console.error(`✗ ${candidates.length} matches — too ambiguous to auto-tag. Rows:`);
      for (const s of candidates) console.log(`   id=${s.id} ${s.createdAt.toISOString().slice(0, 10)} ${inr(s.amount)} "${s.label}" cat=${s.category.name} by=${s.member?.name}`);
      return;
    }
    const s = candidates[0];
    console.log(`Target spend: id=${s.id}  ${s.createdAt.toISOString().slice(0, 10)}  ${inr(s.amount)}  "${s.label}"  cat=${s.category.name}  by=${s.member?.name ?? "—"}`);
    console.log(`Will set cardAccountId=${card.id} and create a family mirror on the card ledger.`);

    if (!APPLY) { console.log("\n(dry run) Re-run with --apply to write.\n"); return; }

    await prisma.$transaction(async (tx) => {
      await tx.spend.update({ where: { id: s.id }, data: { cardAccountId: card.id, memberId: card.memberId } });
      // Mirror onto the owner's personal card ledger (source=family), same shape as doAddSpend.
      await tx.accountTransaction.upsert({
        where: { familySpendId: s.id },
        update: { amount: s.amount, merchant: s.label, accountId: card.id, memberId: card.memberId },
        create: { memberId: card.memberId, accountId: card.id, date: s.createdAt, merchant: s.label, amount: s.amount, type: "spend", category: s.category.name, source: "family", familySpendId: s.id },
      });
    });
    console.log("\n✓ Tagged. Re-run scripts/diagnose-card-cycles.ts — the RBL Sep cycle should now read ~₹9,804.\n");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
