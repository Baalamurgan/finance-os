// READ-ONLY: for each sinking category, compare its template share
// (Category.monthlyBudget) against the sheet "monthly share" line and the Budget
// in every OPEN period. Flags any drift (the ₹/month leak at wind-down).
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const open = await prisma.period.findMany({
    where: { status: "open" },
    select: { id: true, label: true },
  });
  const sinking = await prisma.category.findMany({
    where: { sinking: true },
    select: { id: true, name: true, monthlyBudget: true, cycleMonths: true, onHold: true },
  });

  console.log(`Open periods: ${open.map((p) => p.label).join(", ") || "(none)"}\n`);
  for (const c of sinking) {
    console.log(`# ${c.name}  template share=₹${c.monthlyBudget ?? "null"} cycle=${c.cycleMonths ?? "?"}${c.onHold ? " (on hold)" : ""}`);
    for (const p of open) {
      const lines = await prisma.expenseEntry.findMany({
        where: { periodId: p.id, categoryId: c.id },
        select: { id: true, label: true, amount: true },
      });
      const budget = await prisma.budget.findFirst({
        where: { periodId: p.id, categoryId: c.id },
        select: { planned: true },
      });
      const sheetTotal = lines.reduce((s, l) => s + l.amount, 0);
      const drift = c.monthlyBudget != null && sheetTotal !== c.monthlyBudget;
      console.log(
        `   [${p.label}] sheet=₹${sheetTotal} (${lines.length} line${lines.length === 1 ? "" : "s"}) budget=₹${budget?.planned ?? "none"} ${drift ? "  <-- DRIFT" : "ok"}`,
      );
    }
  }
}

main().finally(() => prisma.$disconnect());
