// One-off: unify set-aside labels so the Activity diff treats them as one item.
// Renames every ExpenseEntry label ending in "(saving)" → "(monthly share)".
// Run once after backing up:  npx tsx scripts/rename-saving-labels.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const rows = await prisma.expenseEntry.findMany({
    where: { label: { endsWith: "(saving)" } },
    select: { id: true, label: true },
  });
  console.log(`Found ${rows.length} "(saving)" lines to rename.`);
  for (const r of rows) {
    const next = r.label.replace(/\(saving\)$/, "(monthly share)");
    await prisma.expenseEntry.update({ where: { id: r.id }, data: { label: next } });
    console.log(`  ${r.label}  →  ${next}`);
  }
  console.log("Done.");
}

main().finally(() => prisma.$disconnect());
