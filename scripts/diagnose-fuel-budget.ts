/**
 * READ-ONLY (you run this): fuel budget vs fuel spend, per month, straight from the data — so you never
 * have to recite past card-bill totals. For each period it prints the Fuel budget (planned), what was
 * actually spent on Fuel, the remaining, and how much of that spend rode a CREDIT CARD (cash leaves at
 * the card's bill, not in the budget month) vs cash. Totals at the bottom.
 *
 * Note: unused fuel each month goes to Piggy at wind-down, so "remaining" is per-month — the running
 * total is "how much fuel was budgeted vs used historically", not a carried-over pool.
 *
 * Run: node_modules/.bin/tsx scripts/diagnose-fuel-budget.ts
 * (optional) match a different category:  node_modules/.bin/tsx scripts/diagnose-fuel-budget.ts "petrol"
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "..", ".env.local") });
config({ path: resolve(__dirname, "..", ".env") });

const url = process.env.DATABASE_URL ?? "";
if (!url || !/^postgres/i.test(url)) { console.error("✗ DATABASE_URL missing/invalid. Run: vercel env pull .env.local"); process.exit(1); }
const NEEDLE = (process.argv[2] ?? "fuel").toLowerCase();
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (s: string, n: number) => s.padStart(n);

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const cats = await prisma.category.findMany({ where: { name: { contains: NEEDLE, mode: "insensitive" } }, select: { id: true, name: true, householdId: true, tracked: true, section: true } });
    if (cats.length === 0) { console.error(`✗ No category whose name contains "${NEEDLE}". Pass a different word as the argument.`); return; }
    if (cats.length > 1) {
      console.log(`Multiple categories match "${NEEDLE}" — using all of them combined:`);
      for (const c of cats) console.log(`   #${c.id} "${c.name}" (${c.section}${c.tracked ? ", tracked" : ""})`);
    } else {
      console.log(`Category: #${cats[0].id} "${cats[0].name}" (${cats[0].section}${cats[0].tracked ? ", tracked" : ""})`);
    }
    const catIds = cats.map((c) => c.id);

    const periods = await prisma.period.findMany({ orderBy: [{ year: "asc" }, { month: "asc" }], select: { id: true, year: true, month: true, status: true } });
    const [budgets, spends] = await Promise.all([
      prisma.budget.findMany({ where: { categoryId: { in: catIds } }, select: { periodId: true, planned: true } }),
      prisma.spend.findMany({ where: { categoryId: { in: catIds } }, select: { periodId: true, amount: true, cardAccountId: true, cardAccount: { select: { type: true, name: true } } } }),
    ]);

    const plannedByPeriod = new Map<number, number>();
    for (const b of budgets) plannedByPeriod.set(b.periodId, (plannedByPeriod.get(b.periodId) ?? 0) + b.planned);
    const spentByPeriod = new Map<number, number>();
    const cardByPeriod = new Map<number, number>(); // spent on a credit card (billed later)
    for (const s of spends) {
      spentByPeriod.set(s.periodId, (spentByPeriod.get(s.periodId) ?? 0) + s.amount);
      if (s.cardAccount?.type === "credit_card") cardByPeriod.set(s.periodId, (cardByPeriod.get(s.periodId) ?? 0) + s.amount);
    }

    console.log("\n month     planned      spent   remaining   (on credit card)");
    console.log(" ────────────────────────────────────────────────────────────");
    let tP = 0, tS = 0, tC = 0;
    for (const p of periods) {
      const planned = plannedByPeriod.get(p.id) ?? 0;
      const spent = spentByPeriod.get(p.id) ?? 0;
      const card = cardByPeriod.get(p.id) ?? 0;
      if (planned === 0 && spent === 0) continue; // skip months with no fuel activity
      tP += planned; tS += spent; tC += card;
      const rem = planned - spent;
      const tag = p.status !== "closed" ? `  ← ${p.status}` : "";
      console.log(` ${MON[p.month - 1]} ${p.year}  ${pad(inr(planned), 9)}  ${pad(inr(spent), 9)}  ${pad(inr(rem), 9)}   ${pad(card > 0 ? inr(card) : "—", 9)}${tag}`);
    }
    console.log(" ────────────────────────────────────────────────────────────");
    console.log(` TOTAL     ${pad(inr(tP), 9)}  ${pad(inr(tS), 9)}  ${pad(inr(tP - tS), 9)}   ${pad(inr(tC), 9)}`);
    console.log("\nremaining = planned − spent (per month). 'on credit card' = fuel whose cash leaves at the");
    console.log("card's bill, not in the budget month — that's the cross-cycle timing you asked about.\n");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
