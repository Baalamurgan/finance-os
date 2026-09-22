/**
 * READ-ONLY (you run this): audits the auto-categorise brain against your REAL spends for the last few
 * months. For every family Personal/Misc spend it prints the typed label, the sub-category it was tagged
 * with (by hand), and what suggestSpendKind() would guess today — flagged as:
 *    ✓ match        suggestion == the tag you chose
 *    ≠ mismatch     suggestion differs from your tag  (keyword may be pointing the wrong way)
 *    · uncovered    no suggestion at all              (a keyword we should ADD)
 * Then a summary of the most common UNCOVERED words, so we know exactly what to teach it.
 *
 * Run:            node_modules/.bin/tsx scripts/analyze-spend-categorize.ts
 * (months back):  node_modules/.bin/tsx scripts/analyze-spend-categorize.ts 4
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { suggestSpendKind, normalizeItem } from "../src/lib/spendCategorize";

config({ path: resolve(__dirname, "..", ".env.local") });
config({ path: resolve(__dirname, "..", ".env") });

const url = process.env.DATABASE_URL ?? "";
if (!url || !/^postgres/i.test(url)) { console.error("✗ DATABASE_URL missing/invalid. Run: vercel env pull .env.local"); process.exit(1); }
const MONTHS_BACK = Math.max(1, Number(process.argv[2] ?? 4));
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const since = new Date();
    since.setMonth(since.getMonth() - MONTHS_BACK, 1);
    since.setHours(0, 0, 0, 0);
    console.log(`Analysing family Misc spends since ${since.toDateString()}  (last ${MONTHS_BACK} month(s))\n`);

    // Family "Personal/Misc" categories (tracked, section Misc) — these carry a free-text subCategory tag.
    const miscCats = await prisma.category.findMany({ where: { section: "Misc", tracked: true }, select: { id: true, name: true } });
    const miscIds = miscCats.map((c) => c.id);
    if (miscIds.length === 0) { console.log("No tracked Misc categories found."); return; }

    const spends = await prisma.spend.findMany({
      where: { categoryId: { in: miscIds }, createdAt: { gte: since } },
      select: { label: true, amount: true, subCategory: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    if (spends.length === 0) { console.log("No Misc spends in that window."); return; }

    let match = 0, mismatch = 0, uncovered = 0;
    const uncoveredWords = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const rows: string[] = [];
    for (const s of spends) {
      const tag = (s.subCategory ?? "").trim() || "—";
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      const guess = suggestSpendKind(s.label);
      let mark = "·  uncovered";
      if (guess == null) {
        uncovered++;
        for (const w of normalizeItem(s.label).split(" ")) if (w.length > 2) uncoveredWords.set(w, (uncoveredWords.get(w) ?? 0) + 1);
      } else if (tag !== "—" && normalizeItem(guess) === normalizeItem(tag)) {
        match++; mark = "✓  match";
      } else {
        mismatch++; mark = "≠  mismatch";
      }
      rows.push(`  ${mark.padEnd(12)} "${s.label}"  ${inr(s.amount)}   tagged=[${tag}]  guess=[${guess ?? "none"}]`);
    }

    console.log(rows.join("\n"));
    console.log(`\n── Totals: ${match} match · ${mismatch} mismatch · ${uncovered} uncovered  (of ${spends.length})`);

    console.log(`\n── Sub-categories you actually used (tag → count):`);
    for (const [t, n] of [...tagCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(3)}  ${t}`);

    console.log(`\n── Most common words in UNCOVERED spends (candidates to teach the categoriser):`);
    const top = [...uncoveredWords.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 40);
    if (top.length === 0) console.log("     (none repeated — uncovered spends are all one-offs)");
    for (const [w, n] of top) console.log(`     ${String(n).padStart(3)}  ${w}`);

    console.log(`\nNothing was written. Paste this back and I'll expand the keyword tables from what you actually spend on.`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
