// One-off: give every sinking fund the same canonical sheet label
// "{name} (monthly share)" in each OPEN period (EB already had it; WiFi/GAS/Mobile/
// LPG kept their imported labels). Amount stays = the category's monthlyBudget, so
// no net-worth change — just consistent labels. Idempotent. Matches what month
// generation now produces (clonePeriodStructure / ensureCurrentMonth).
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const open = await prisma.period.findMany({ where: { status: "open" }, select: { id: true, label: true } });
  const sinking = await prisma.category.findMany({
    where: { sinking: true, onHold: false, monthlyBudget: { not: null } },
    select: { id: true, name: true, monthlyBudget: true, necessary: true },
  });

  let changed = 0;
  for (const p of open) {
    for (const cat of sinking) {
      const label = `${cat.name} (monthly share)`;
      const lines = await prisma.expenseEntry.findMany({
        where: { periodId: p.id, categoryId: cat.id },
        select: { id: true, label: true, amount: true },
      });
      // already exactly one canonical line at the right amount → skip
      if (lines.length === 1 && lines[0].label === label && lines[0].amount === cat.monthlyBudget) continue;

      await prisma.$transaction([
        prisma.expenseEntry.deleteMany({ where: { periodId: p.id, categoryId: cat.id } }),
        prisma.expenseEntry.create({
          data: { periodId: p.id, categoryId: cat.id, label, amount: cat.monthlyBudget!, necessary: cat.necessary },
        }),
      ]);
      console.log(`[${p.label}] ${cat.name} → "${label}" ₹${cat.monthlyBudget}`);
      changed++;
    }
  }
  console.log(`\nDone. lines updated: ${changed}.`);
}

main().finally(() => prisma.$disconnect());
