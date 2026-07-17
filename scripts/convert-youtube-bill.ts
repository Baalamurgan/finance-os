// One-time: convert YouTube Premium from a tracked ₹299 monthly budget into a MONTHLY
// "save the share" bill-with-a-fund (paid each month via the In-Hand pay button), and make
// July/August consistent. Run AFTER db:backup.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const yt = await prisma.category.findFirst({ where: { name: { contains: "outube", mode: "insensitive" } } });
  if (!yt) throw new Error("YouTube category not found");
  const amount = yt.monthlyBudget ?? yt.billAmount ?? 299;

  await prisma.category.update({
    where: { id: yt.id },
    data: {
      fundingStyle: "auto", billEveryMonths: 1, billAmount: amount, billMonth: 7,
      saveEveryMonths: 1, tracked: false, sinking: false, fixed: false, monthlyBudget: null,
    },
  });
  console.log(`Config → monthly save-the-share bill (₹${amount}, every 1 month).`);

  // Make the existing plain "Youtube premium" lines the set-aside "(monthly share)" lines so
  // In-Hand treats them as the fund/earmark and shows a payable bill-due.
  const lines = await prisma.expenseEntry.findMany({ where: { categoryId: yt.id, label: { not: { endsWith: "(monthly share)" } } } });
  for (const l of lines) {
    await prisma.expenseEntry.update({ where: { id: l.id }, data: { label: `${yt.name} (monthly share)` } });
    console.log(`  renamed line #${l.id} "${l.label}" → "${yt.name} (monthly share)"`);
  }

  // A bill-with-a-fund has no budget envelope — drop any leftover YouTube budget rows.
  const delBudgets = await prisma.budget.deleteMany({ where: { categoryId: yt.id } });
  console.log(`  removed ${delBudgets.count} budget row(s).`);

  console.log("Done. Rebuild the AUG draft to refresh it from the template.");
}
main().finally(() => prisma.$disconnect());
