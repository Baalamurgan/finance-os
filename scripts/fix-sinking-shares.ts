// One-off: set EB's sinking monthly SHARE to ₹1,000 (bill ~₹2,000 every 2 months)
// and sync the OPEN month(s) — its Budget + the sheet "EB (monthly share)" line —
// so the fund math is correct going forward. Other sinking shares (WiFi/Mobile/LPG)
// are left for the head to set in Setup (which now auto-syncs the sheet).
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const SHARE = 1000;
const CYCLE = 2;

async function main() {
  const eb = await prisma.category.findFirst({ where: { name: "EB" } });
  if (!eb) { console.log("No EB category."); return; }

  await prisma.category.update({
    where: { id: eb.id },
    data: { sinking: true, tracked: true, monthlyBudget: SHARE, cycleMonths: CYCLE },
  });

  const open = await prisma.period.findMany({ where: { householdId: eb.householdId, status: "open" }, select: { id: true, label: true } });
  for (const p of open) {
    const existing = await prisma.budget.findFirst({ where: { periodId: p.id, categoryId: eb.id } });
    if (existing) await prisma.budget.update({ where: { id: existing.id }, data: { planned: SHARE } });
    else await prisma.budget.create({ data: { periodId: p.id, categoryId: eb.id, planned: SHARE } });

    await prisma.$transaction([
      prisma.expenseEntry.deleteMany({ where: { periodId: p.id, categoryId: eb.id } }),
      prisma.expenseEntry.create({
        data: { periodId: p.id, categoryId: eb.id, label: "EB (monthly share)", amount: SHARE, necessary: eb.necessary },
      }),
    ]);
    console.log(`${p.label}: EB share set to ${SHARE} (budget + sheet line)`);
  }
  console.log("✓ Done. Set WiFi/Mobile/LPG shares in Setup when ready.");
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
