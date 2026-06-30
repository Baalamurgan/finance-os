// One-off: align the EB sheet allocation with its monthly budget in every OPEN
// period (July was cloned from March which had EB=2000 while the budget is 1000,
// causing ₹1,000/mo to leak at wind-down). Idempotent. Run once against the DB.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const eb = await prisma.category.findFirst({ where: { name: "EB" } });
  if (!eb) {
    console.log("No EB category found — nothing to do.");
    return;
  }
  const budget = eb.monthlyBudget ?? 1000;
  const openPeriods = await prisma.period.findMany({ where: { status: "open" } });

  for (const p of openPeriods) {
    const entries = await prisma.expenseEntry.findMany({
      where: { periodId: p.id, categoryId: eb.id },
    });
    const total = entries.reduce((s, e) => s + e.amount, 0);
    if (Math.abs(total - budget) < 0.005) {
      console.log(`${p.label}: EB already ${budget} — skip`);
      continue;
    }
    await prisma.$transaction([
      prisma.expenseEntry.deleteMany({ where: { periodId: p.id, categoryId: eb.id } }),
      prisma.expenseEntry.create({
        data: {
          periodId: p.id,
          categoryId: eb.id,
          label: "EB (monthly share)",
          amount: budget,
          necessary: eb.necessary,
          memberId: entries[0]?.memberId ?? null,
        },
      }),
    ]);
    console.log(`${p.label}: EB allocation ${total} -> ${budget}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
