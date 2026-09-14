/**
 * Repair misc spend cards broken by a draft rebuild: a card created via the toggle wasn't pinned,
 * so clearGeneratedRows wiped its Budget (and the clone won't regenerate a one-off card) — leaving a
 * line with no budget (→ shows under "misc · unplanned", no kept badge). For every miscCard category
 * in a live (open/draft) period that has expense line(s), this PINS those lines and upserts a Budget
 * = the lines' total, so the card is a proper budgeted card again. Idempotent.
 *
 * Also REPORTS (never deletes) any plain Personal/Misc sheet line whose label matches a card name —
 * likely a pre-conversion duplicate for you to remove by hand.
 *
 * Dry run:  node_modules/.bin/tsx scripts/repair-misc-cards.ts
 * Apply:    node_modules/.bin/tsx scripts/repair-misc-cards.ts --apply
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const APPLY = process.argv.includes("--apply");

async function main() {
  const periods = await prisma.period.findMany({
    where: { status: { in: ["open", "draft"] } },
    select: { id: true, label: true, householdId: true },
  });
  if (periods.length === 0) { console.log("No live periods."); return; }
  const hh = periods[0].householdId;
  const cards = await prisma.category.findMany({ where: { householdId: hh, miscCard: true }, select: { id: true, name: true } });
  const cardNames = new Set(cards.map((c) => c.name));
  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — ${cards.length} misc cards across ${periods.map((p) => p.label).join(", ")}\n`);

  let fixed = 0;
  for (const p of periods) {
    for (const card of cards) {
      const lines = await prisma.expenseEntry.findMany({ where: { periodId: p.id, categoryId: card.id }, select: { id: true, amount: true, pinned: true } });
      if (lines.length === 0) continue;
      const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
      const budget = await prisma.budget.findUnique({ where: { periodId_categoryId: { periodId: p.id, categoryId: card.id } }, select: { planned: true } });
      const needsPin = lines.some((l) => !l.pinned);
      const needsBudget = !budget || Math.abs((budget.planned ?? 0) - total) > 0.005;
      if (!needsPin && !needsBudget) continue;
      console.log(`  ${p.label} · "${card.name}": ${needsPin ? "pin lines" : ""}${needsPin && needsBudget ? " + " : ""}${needsBudget ? `budget ${budget?.planned ?? "—"}→${total}` : ""}`);
      fixed++;
      if (!APPLY) continue;
      if (needsPin) await prisma.expenseEntry.updateMany({ where: { periodId: p.id, categoryId: card.id }, data: { pinned: true } });
      if (needsBudget) await prisma.budget.upsert({
        where: { periodId_categoryId: { periodId: p.id, categoryId: card.id } },
        create: { periodId: p.id, categoryId: card.id, planned: total },
        update: { planned: total },
      });
    }
    // report possible pre-conversion duplicates: plain misc-bucket sheet lines named like a card
    const dupes = await prisma.expenseEntry.findMany({
      where: { periodId: p.id, note: null, category: { section: "Misc", miscCard: false } },
      select: { id: true, label: true, amount: true },
    });
    for (const d of dupes) if (cardNames.has(d.label.trim())) console.log(`  ⚠ ${p.label} · duplicate misc-bucket line "${d.label}" ₹${d.amount} (#${d.id}) — a card with this name exists; remove this line by hand if it's a leftover`);
  }
  console.log(`\n${APPLY ? "Fixed" : "Would fix"} ${fixed} card/period pair(s).`);
  if (!APPLY) console.log("Re-run with --apply to write.");
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
