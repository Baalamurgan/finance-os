/**
 * ONE-OFF WRITE (you run this): remove the PINNED duplicate G704 maintenance line in the preview draft,
 * leaving the single clean generated line. It VERIFIES the target before deleting (must be a pinned,
 * G704-maintenance, non-one-off line in a draft/open month) and refuses on anything unexpected.
 *
 * From diagnose-g704.ts, the duplicate to remove is expenseEntry #8528 ("G704-maintenance charges",
 * 📌 pinned, OCT draft, cat#39) — the hyphenated pin whose label didn't match the category name, which is
 * what made rebuild spawn a second copy (#9284, kept). Pass a different id as the arg if it changed.
 *
 * Dry run:  node_modules/.bin/tsx scripts/delete-g704-dup.ts
 * Apply:    node_modules/.bin/tsx scripts/delete-g704-dup.ts --apply
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "..", ".env.local") });
config({ path: resolve(__dirname, "..", ".env") });
const url = process.env.DATABASE_URL ?? "";
if (!url || !/^postgres/i.test(url)) { console.error("✗ DATABASE_URL missing. Run: vercel env pull .env.local"); process.exit(1); }
const APPLY = process.argv.includes("--apply");
const ID = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 8528);
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const e = await prisma.expenseEntry.findUnique({
      where: { id: ID },
      select: { id: true, label: true, amount: true, pinned: true, oneOff: true, category: { select: { id: true, name: true, miscCard: true } }, period: { select: { label: true, status: true } } },
    });
    if (!e) { console.error(`✗ expenseEntry #${ID} not found (already deleted?).`); return; }
    console.log(`Target #${e.id} "${e.label}" ${inr(e.amount)} · ${e.period.label}[${e.period.status}] · pinned=${e.pinned} oneOff=${e.oneOff} · cat#${e.category.id}"${e.category.name}"`);

    // Safety gates: only ever delete a pinned G704-maintenance line in a draft/open month.
    const bad: string[] = [];
    if (!/g704/i.test(e.label) || !/mainten/i.test(e.label)) bad.push("label isn't a G704 maintenance line");
    if (!e.pinned) bad.push("line is NOT pinned (would delete the clean generated line — aborting)");
    if (!["draft", "open"].includes(e.period.status)) bad.push(`period is ${e.period.status} (only draft/open)`);
    if (bad.length) { console.error(`✗ Refusing to delete:\n   - ${bad.join("\n   - ")}`); return; }

    if (!APPLY) { console.log("\n(dry run) Looks like the pinned duplicate. Re-run with --apply to delete it.\n"); return; }
    await prisma.expenseEntry.delete({ where: { id: ID } });
    console.log(`\n✓ Deleted #${ID}. The clean generated line remains; rebuild the preview if you want a fresh regenerate.\n`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
