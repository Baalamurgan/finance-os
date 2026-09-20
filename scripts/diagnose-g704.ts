/**
 * READ-ONLY: find the "G704 maintenance" expense line(s) — which member it's attributed to, which month,
 * amount, paid state, and note — so we can decide exactly where it should land. Nothing is written.
 *
 * Run:  node_modules/.bin/tsx scripts/diagnose-g704.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "..", ".env.local") });
config({ path: resolve(__dirname, "..", ".env") });
const url = process.env.DATABASE_URL ?? "";
if (!url || !/^postgres/i.test(url)) { console.error("✗ DATABASE_URL missing. Run: vercel env pull .env.local"); process.exit(1); }
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const rows = await prisma.expenseEntry.findMany({
      where: { OR: [{ label: { contains: "G704", mode: "insensitive" } }, { label: { contains: "maintenance", mode: "insensitive" } }] },
      select: { id: true, label: true, amount: true, paid: true, note: true, memberId: true, member: { select: { name: true } }, category: { select: { name: true, section: true, tracked: true, fundingStyle: true } }, period: { select: { label: true, status: true, year: true, month: true } } },
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) { console.log("No expense line matching G704 / maintenance."); return; }
    for (const e of rows) {
      console.log(`#${e.id} "${e.label}" ${inr(e.amount)} · ${e.period.label}[${e.period.status}] · member=${e.member?.name ?? "(shared/none)"} · paid=${e.paid} · cat=${e.category.name}(section=${e.category.section},tracked=${e.category.tracked},funding=${e.category.fundingStyle ?? "-"}) · note=${e.note ?? "-"}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
