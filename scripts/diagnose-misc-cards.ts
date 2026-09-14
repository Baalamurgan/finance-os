/**
 * READ-ONLY diagnostic for the misc-spend-card issues. Dumps, for the live open (Sept) and
 * draft (Oct) periods: every miscCard category with its flags + whether it has a budget/spends
 * in each period, and every misc-ish expense line in each period (section Misc OR a miscCard
 * category) with its flags. Nothing is written.
 *
 * Run: node_modules/.bin/tsx scripts/diagnose-misc-cards.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const periods = await prisma.period.findMany({
    where: { status: { in: ["open", "draft"] } },
    select: { id: true, year: true, month: true, label: true, status: true, householdId: true },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  console.log("Live periods:", periods.map((p) => `${p.label} [${p.status}] #${p.id}`).join(", "), "\n");
  if (periods.length === 0) return;
  const hh = periods[0].householdId;

  const miscCards = await prisma.category.findMany({
    where: { householdId: hh, miscCard: true },
    select: { id: true, name: true, section: true, monthlyBudget: true, miscCard: true, repeatYearly: true, billMonth: true, responsibleMemberId: true, onHold: true },
    orderBy: { name: "asc" },
  });
  console.log(`=== miscCard categories (${miscCards.length}) ===`);
  for (const c of miscCards) {
    const parts: string[] = [];
    for (const p of periods) {
      const budget = await prisma.budget.findUnique({ where: { periodId_categoryId: { periodId: p.id, categoryId: c.id } }, select: { planned: true } });
      const spendCount = await prisma.spend.count({ where: { periodId: p.id, categoryId: c.id } });
      const lineCount = await prisma.expenseEntry.count({ where: { periodId: p.id, categoryId: c.id } });
      parts.push(`${p.label}: budget=${budget?.planned ?? "—"} spends=${spendCount} lines=${lineCount}`);
    }
    console.log(`  #${c.id} "${c.name}" section=${c.section} yearly=${c.repeatYearly} billMonth=${c.billMonth ?? "—"} budgetTmpl=${c.monthlyBudget ?? "—"} onHold=${c.onHold}`);
    console.log(`      ${parts.join(" | ")}`);
  }

  for (const p of periods) {
    const lines = await prisma.expenseEntry.findMany({
      where: { periodId: p.id, OR: [{ category: { section: "Misc" } }, { category: { miscCard: true } }] },
      select: { id: true, label: true, amount: true, note: true, pinned: true, memberId: true, category: { select: { name: true, section: true, miscCard: true } } },
      orderBy: { id: "asc" },
    });
    console.log(`\n=== ${p.label} misc-ish expense lines (${lines.length}) ===`);
    for (const e of lines) {
      console.log(`  "${e.label}" ₹${e.amount} cat="${e.category?.name}" section=${e.category?.section} miscCard=${e.category?.miscCard} note=${e.note ?? "null"} pinned=${e.pinned} member=${e.memberId ?? "shared"}`);
    }
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
