/**
 * READ-ONLY: every Spend / ExpenseEntry whose label mentions "cot" (Oct + Nov), so we can see what is
 * left of the G704 cot after the direct DB delete, and which row the November "OCT · Cot for G704" is.
 * Run: node_modules/.bin/tsx scripts/diagnose-cot.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "..", ".env.local") });
config({ path: resolve(__dirname, "..", ".env") });
const url = process.env.DATABASE_URL ?? "";
if (!url || !/^postgres/i.test(url)) { console.error("✗ DATABASE_URL missing. Run: vercel env pull .env.local"); process.exit(1); }

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const spends = await prisma.spend.findMany({
      where: { label: { contains: "cot", mode: "insensitive" } },
      include: { period: { select: { label: true, status: true } }, category: { select: { name: true } }, member: { select: { name: true } } },
      orderBy: { id: "asc" },
    });
    console.log("SPENDS");
    for (const s of spends) console.log(`  #${s.id} "${s.label}" ₹${s.amount} · ${s.category.name} · ${s.member?.name ?? "—"} · ${s.period.label}[${s.period.status}] · ${s.createdAt.toISOString().slice(0, 10)}`);
    if (!spends.length) console.log("  (none)");
    const exps = await prisma.expenseEntry.findMany({
      where: { label: { contains: "cot", mode: "insensitive" } },
      include: { period: { select: { label: true, status: true } }, category: { select: { name: true } }, member: { select: { name: true } } },
      orderBy: { id: "asc" },
    });
    console.log("EXPENSE (SHEET) LINES");
    for (const e of exps) console.log(`  #${e.id} "${e.label}" ₹${e.amount} · ${e.category.name} · ${e.member?.name ?? "—"} · ${e.period.label}[${e.period.status}] · note=${e.note} oneOff=${e.oneOff} paid=${e.paid} pinned=${e.pinned}`);
    if (!exps.length) console.log("  (none)");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
