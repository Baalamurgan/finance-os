/**
 * READ-ONLY: for the OPEN month, list every spend that used a card — the card's name/type/owner, who the
 * spend is attributed to (memberId) and who logged it — plus a per-member tally of credit-card spends.
 * Lets us see why a member's "on cards" line is/ isn't showing. Nothing is written.
 *
 * Run:  node_modules/.bin/tsx scripts/diagnose-card-spends.ts
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
    const household = await prisma.household.findFirst({ select: { id: true } });
    if (!household) { console.log("No household."); return; }
    const period = await prisma.period.findFirst({ where: { householdId: household.id, status: "open" }, orderBy: [{ year: "desc" }, { month: "desc" }], select: { id: true, label: true } });
    if (!period) { console.log("No open period."); return; }
    console.log(`Open month: ${period.label}\n`);

    const spends = await prisma.spend.findMany({
      where: { periodId: period.id, cardAccountId: { not: null } },
      select: { amount: true, label: true, member: { select: { name: true } }, loggedBy: { select: { name: true } }, category: { select: { name: true } }, cardAccount: { select: { name: true, type: true, member: { select: { name: true } } } } },
      orderBy: { amount: "desc" },
    });
    if (spends.length === 0) { console.log("No card spends this month."); return; }
    console.log("CARD SPENDS (attributed to = card owner):");
    for (const s of spends) {
      console.log(`  ${inr(s.amount).padStart(9)}  ${s.cardAccount?.type ?? "?"}  "${s.cardAccount?.name}" (owner ${s.cardAccount?.member?.name}) · attributed=${s.member?.name ?? "—"} · logged=${s.loggedBy?.name ?? "—"} · ${s.category.name} · ${s.label}`);
    }
    const byMemberCredit = new Map<string, number>();
    for (const s of spends) {
      if (s.cardAccount?.type !== "credit_card") continue;
      const m = s.member?.name ?? "—";
      byMemberCredit.set(m, (byMemberCredit.get(m) ?? 0) + s.amount);
    }
    console.log("\nCREDIT-card spends per attributed member (this is what drives the 'on cards' line):");
    for (const [m, v] of byMemberCredit) console.log(`  ${m}: ${inr(v)}`);
    console.log("");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
