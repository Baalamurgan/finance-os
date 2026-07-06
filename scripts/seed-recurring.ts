// One-time: seed the RecurringItem template from the latest OPEN month's recurring
// (non-one-off) income + expense lines. Idempotent (skips if items already exist).
// Skips carry/surplus-marked lines + obvious one-offs (Last month… / From Piggy…).
// The head prunes anything that shouldn't recur in Setup afterwards.
//   set -a; source .env.local; set +a; npx tsx scripts/seed-recurring.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const ONE_OFF_NAME = /^(Last month|From Piggy)/i;

async function main() {
  const h = await prisma.household.findFirst();
  if (!h) return console.log("no household");
  const existing = await prisma.recurringItem.count({ where: { householdId: h.id } });
  if (existing > 0) return console.log(`RecurringItem already seeded (${existing}). Skipping.`);

  const src = await prisma.period.findFirst({ where: { householdId: h.id, status: "open" }, orderBy: [{ year: "desc" }, { month: "desc" }] });
  if (!src) return console.log("no open period");

  const [incomes, expenses] = await Promise.all([
    prisma.incomeEntry.findMany({ where: { periodId: src.id, oneOff: false }, orderBy: { amount: "desc" } }),
    prisma.expenseEntry.findMany({ where: { periodId: src.id, oneOff: false }, orderBy: { amount: "desc" } }),
  ]);

  const data: { householdId: number; kind: string; name: string; amount: number; categoryId: number | null; memberId: number | null; sortOrder: number }[] = [];
  let n = 0;
  for (const i of incomes) {
    if (i.note?.startsWith("__") || ONE_OFF_NAME.test(i.source)) continue;
    data.push({ householdId: h.id, kind: "income", name: i.source, amount: i.amount, categoryId: null, memberId: i.ownerId, sortOrder: n++ });
  }
  for (const e of expenses) {
    if (e.note?.startsWith("__") || ONE_OFF_NAME.test(e.label)) continue;
    data.push({ householdId: h.id, kind: "expense", name: e.label, amount: e.amount, categoryId: e.categoryId, memberId: e.memberId, sortOrder: n++ });
  }

  await prisma.recurringItem.createMany({ data });
  console.log(`✓ Seeded ${data.length} RecurringItems from ${src.label} (${data.filter((d) => d.kind === "income").length} income, ${data.filter((d) => d.kind === "expense").length} expense).`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
