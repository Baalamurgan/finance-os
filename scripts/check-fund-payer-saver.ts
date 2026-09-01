import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// READ-ONLY. Lists every sinking / goal-based fund category and compares its SAVER (who the fund is
// held under = responsibleMemberId) against its PAYER (who pays the bill = payerMemberId, falling
// back to the saver). When payer == saver (the usual case) the fund draw nets within one person.
// When they DIFFER, the app is designed to tag the bill AND a fund credit to the payer so they net
// to ~0 (see schema: Category.payerMemberId) — so it's not automatically a bug, but it's the case to
// eyeball: confirm that payer nets ~0 in Settlement / In-Hand, or just set payer = saver to keep it
// simple. This flags the mismatches so you know which categories rely on that net-zero tagging.
// Run:  npx tsx scripts/check-fund-payer-saver.ts
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const h = await prisma.household.findFirst({ select: { id: true, name: true } });
  if (!h) return console.log("no household");

  const members = await prisma.member.findMany({ where: { householdId: h.id }, select: { id: true, name: true } });
  const nameOf = (id: number | null) => (id == null ? "— (shared/holder)" : members.find((m) => m.id === id)?.name ?? `#${id}`);

  const cats = await prisma.category.findMany({
    where: { householdId: h.id, OR: [{ sinking: true }, { fundingStyle: { not: null } }] },
    select: { id: true, name: true, sinking: true, fundingStyle: true, responsibleMemberId: true, payerMemberId: true, onHold: true },
    orderBy: { name: "asc" },
  });

  console.log(`\nFund categories for ${h.name}:\n`);
  const mismatches: string[] = [];
  for (const c of cats) {
    const saver = c.responsibleMemberId;          // who the fund is held under
    const payer = c.payerMemberId ?? c.responsibleMemberId; // who actually pays the bill
    const diff = c.payerMemberId != null && c.payerMemberId !== saver;
    const tag = c.sinking ? "sinking" : `fund:${c.fundingStyle}`;
    const flag = diff ? "  ⚠ PAYER ≠ SAVER" : "";
    console.log(
      `  ${diff ? "⚠" : "·"} ${c.name.padEnd(28)} [${tag}]${c.onHold ? " (on hold)" : ""}\n` +
      `      saver: ${nameOf(saver)}   payer: ${nameOf(payer)}${flag}`,
    );
    if (diff) mismatches.push(`${c.name}: saver ${nameOf(saver)} but payer ${nameOf(payer)}`);
  }

  console.log("\n" + "─".repeat(60));
  if (mismatches.length === 0) {
    console.log("✓ All fund categories: payer == saver — every fund draw nets within one person. Nothing to verify.");
  } else {
    console.log(`ℹ ${mismatches.length} fund categor${mismatches.length === 1 ? "y has" : "ies have"} payer ≠ saver:`);
    for (const m of mismatches) console.log("   • " + m);
    console.log("\n  These rely on the net-zero design: the app tags the bill AND a fund credit to the");
    console.log("  PAYER, so they should come out ~0 (the SAVER's held fund is what actually funds it).");
    console.log("  Worth eyeballing: open Settlement / In-Hand for the payer on a due month and confirm");
    console.log("  they net ~0 on that bill. If it doesn't look right, set payer = saver in Setup and");
    console.log("  it collapses to the simple single-person case.");
  }
  console.log("");
}

main().finally(() => prisma.$disconnect());
