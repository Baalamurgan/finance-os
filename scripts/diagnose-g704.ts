/**
 * READ-ONLY: full picture of the "G704 maintenance" duplicate so we can delete the RIGHT row. Shows the
 * expense LINES (with pinned / oneOff / period), the CATEGORIES (miscCard / repeatMonthly flags), and any
 * remaining RecurringItem templates. Nothing is written.
 *
 * The duplicate-after-rebuild pattern: a PINNED leftover line survives every rebuild (by design), so once
 * the old recurring copy was pinned, deleting its template didn't remove it — the pinned orphan stays and
 * rebuild also regenerates the repeatMonthly spend card → two rows.
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
    const like = { contains: "G704", mode: "insensitive" as const };

    console.log("── EXPENSE LINES (the rows you see on the Sheet) ──");
    const rows = await prisma.expenseEntry.findMany({
      where: { label: like },
      select: {
        id: true, label: true, amount: true, pinned: true, oneOff: true, paid: true, note: true,
        member: { select: { name: true } },
        category: { select: { id: true, name: true, miscCard: true, repeatMonthly: true, repeatYearly: true } },
        period: { select: { label: true, status: true } },
      },
      orderBy: [{ period: { year: "asc" } }, { period: { month: "asc" } }, { id: "asc" }],
    });
    if (rows.length === 0) console.log("  (none)");
    for (const e of rows) {
      console.log(
        `  #${e.id} "${e.label}" ${inr(e.amount)} · ${e.period.label}[${e.period.status}]` +
        ` · ${e.pinned ? "📌PINNED" : "not-pinned"} · oneOff=${e.oneOff} · member=${e.member?.name ?? "-"}` +
        ` · cat#${e.category.id}"${e.category.name}"(miscCard=${e.category.miscCard},repeatMonthly=${e.category.repeatMonthly},repeatYearly=${e.category.repeatYearly})` +
        ` · note=${e.note ?? "-"}`,
      );
    }

    console.log("\n── CATEGORIES named G704 ──");
    const cats = await prisma.category.findMany({ where: { name: like }, select: { id: true, name: true, section: true, tracked: true, miscCard: true, repeatMonthly: true, repeatYearly: true, monthlyBudget: true } });
    if (cats.length === 0) console.log("  (none)");
    for (const c of cats) console.log(`  cat#${c.id} "${c.name}" · section=${c.section} tracked=${c.tracked} miscCard=${c.miscCard} repeatMonthly=${c.repeatMonthly} repeatYearly=${c.repeatYearly} budget=${c.monthlyBudget}`);

    console.log("\n── RECURRING ITEM templates named G704 (should be GONE after the merge) ──");
    const items = await prisma.recurringItem.findMany({ where: { name: like }, select: { id: true, name: true, amount: true, kind: true, active: true, categoryId: true } });
    if (items.length === 0) console.log("  (none — good)");
    for (const it of items) console.log(`  RecurringItem#${it.id} "${it.name}" ${inr(it.amount)} kind=${it.kind} active=${it.active} categoryId=${it.categoryId}`);

    console.log("\nNothing was written. Paste this and I'll tell you exactly which line id to delete.");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
