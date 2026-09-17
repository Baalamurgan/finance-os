/**
 * READ-ONLY: show what getPendingCardBills returns per period (bypasses the getInHand cache), plus the
 * raw getCardDues cycles, so we can tell a data/logic bug apart from a stale cache.
 *
 * Run:  node_modules/.bin/tsx scripts/diagnose-pending-bills.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "..", ".env.local") });
config({ path: resolve(__dirname, "..", ".env") });
const url = process.env.DATABASE_URL ?? "";
if (!url || !/^postgres/i.test(url)) { console.error("✗ DATABASE_URL missing. Run: vercel env pull .env.local"); process.exit(1); }
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const d10 = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "—");

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { getPendingCardBills } = await import("../src/lib/queries");
  const { getCardDues } = await import("../src/lib/personal/cash");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const household = await prisma.household.findFirst({ select: { id: true } });
    if (!household) { console.log("No household."); return; }

    const cards = await prisma.financeAccount.findMany({ where: { type: "credit_card", member: { householdId: household.id } }, select: { id: true, name: true, memberId: true, member: { select: { name: true } } } });
    console.log("Family credit cards:", cards.map((c) => `#${c.id} ${c.name} (owner ${c.member.name} #${c.memberId})`).join(" | ") || "(none)");

    for (const ownerId of [...new Set(cards.map((c) => c.memberId))]) {
      const dues = await getCardDues(ownerId);
      for (const dd of dues) {
        for (const cyc of dd.cycles) {
          console.log(`  getCardDues → ${dd.cardName}: cycle end ${d10(cyc.cycleEndISO)} due ${d10(cyc.dueISO)}  personal ${inr(cyc.total)}  family ${inr(cyc.familyTotal)}`);
        }
      }
    }

    const periods = await prisma.period.findMany({ where: { householdId: household.id }, select: { id: true, year: true, month: true, status: true, label: true }, orderBy: [{ year: "asc" }, { month: "asc" }] });
    console.log("\nPeriods:", periods.map((p) => `${p.label}[${p.status}] y=${p.year} m=${p.month}`).join(" | "));
    for (const p of periods) {
      if (p.status === "closed") continue;
      const pending = await getPendingCardBills(household.id, { year: p.year, month: p.month });
      console.log(`\n▸ ${p.label} (m=${p.month}) getPendingCardBills → ${pending.length} bill(s)`);
      for (const b of pending) console.log(`    ${b.cardName}  due ${d10(b.dueISO)}  family ${inr(b.familyAmount)}  personal ${inr(b.personalAmount)}  owner ${b.ownerName}`);
    }
    console.log("");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
