/**
 * One-time (F-4): convert the existing single-Pay-button planned MISC lines in the live
 * September + October months into budgeted misc SPEND CARDS (like veggies) — a tracked
 * "Monthly" category + a Budget envelope for that month. Members then log spends into them,
 * remaining → Piggy, overspend → next month, all via the normal budget engine.
 *
 * Targets ONLY planned misc lines: ExpenseEntry with note=null (so pool/carry/removed lines
 * are left alone) whose category.section = "Misc" and isn't already a card. Ad-hoc misc SPENDS
 * (Spend rows) are NOT touched. Same-named lines across the two months reuse one card category.
 * Idempotent (a converted line points at a miscCard category → skipped on re-run).
 *
 * Scope: periods with month 9 or 10 that are still live (status open|draft) — the current Sept
 * and the Oct preview. Closed historical Septembers are left untouched.
 *
 * Dry run (default):  node_modules/.bin/tsx scripts/convert-misc-to-spend-cards.ts
 * Apply:              node_modules/.bin/tsx scripts/convert-misc-to-spend-cards.ts --apply
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
    where: { month: { in: [9, 10] }, status: { in: ["open", "draft"] } },
    select: { id: true, householdId: true, year: true, month: true, label: true },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  if (periods.length === 0) { console.log("No live Sept/Oct period found — nothing to do."); return; }
  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — target months: ${periods.map((p) => p.label).join(", ")}\n`);

  let converted = 0, skipped = 0;
  for (const period of periods) {
    const lines = await prisma.expenseEntry.findMany({
      where: { periodId: period.id, note: null, category: { section: "Misc", miscCard: false } },
      include: { category: { select: { name: true, tracked: true } } },
      orderBy: { id: "asc" },
    });
    console.log(`— ${period.label}: ${lines.length} planned misc line(s)`);
    for (const line of lines) {
      const name = line.label.trim().slice(0, 40);
      if (!name || line.amount <= 0) { skipped++; console.log(`    · skip line #${line.id} (empty name / non-positive amount)`); continue; }
      const existing = await prisma.category.findFirst({ where: { householdId: period.householdId, name } });
      if (existing && !existing.miscCard) {
        skipped++;
        console.log(`    · skip “${name}” (₹${line.amount}) — a non-card category already owns that name; convert by hand`);
        continue;
      }
      console.log(`    ✓ “${name}” ₹${line.amount}${existing ? " → reuse existing card" : " → new card"}${line.memberId != null ? ` (holder ${line.memberId})` : " (shared)"}`);
      if (!APPLY) { converted++; continue; }
      await prisma.$transaction(async (tx) => {
        const cat = existing ?? (await tx.category.create({
          data: {
            householdId: period.householdId, name, section: "Monthly", tracked: true,
            monthlyBudget: line.amount, responsibleMemberId: line.memberId, miscCard: true, repeatYearly: false,
          },
        }));
        await tx.expenseEntry.update({ where: { id: line.id }, data: { categoryId: cat.id } });
        await tx.budget.upsert({
          where: { periodId_categoryId: { periodId: period.id, categoryId: cat.id } },
          create: { periodId: period.id, categoryId: cat.id, planned: line.amount },
          update: { planned: line.amount },
        });
      });
      converted++;
    }
  }
  console.log(`\n${APPLY ? "Converted" : "Would convert"} ${converted}, skipped ${skipped}.`);
  if (!APPLY) console.log("Re-run with --apply to make the changes.");
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
