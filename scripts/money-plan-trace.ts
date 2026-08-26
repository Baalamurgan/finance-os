import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { computeSettlement } from "../src/lib/settlement-core";

// READ-ONLY. Traces where a Money-Plan settlement transfer "went" after being marked done.
// A settlement transfer step is a LIVE projection: computeSettlement only emits it while the
// member's net (contributed − paid) is non-zero. Marking it done writes a SettlementRecord (the
// money is recorded), but if the net also fell to ~0 the step has nothing left to render and drops
// out of the plan. This script lists every settlement record + each member's live net, and flags
// ORPHANED records (a record with no matching live transfer) — those are the vanished steps.
// Run:  npx tsx scripts/money-plan-trace.ts
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function main() {
  const h = await prisma.household.findFirst({ select: { id: true, name: true, treasurerMemberId: true } });
  if (!h) return console.log("no household");
  const open = await prisma.period.findFirst({ where: { householdId: h.id, status: "open" }, orderBy: [{ year: "asc" }, { month: "asc" }] });
  if (!open) return console.log("no open month");
  const treasurerId = open.treasurerMemberId ?? h.treasurerMemberId; // period override wins, like getInHand
  const prevMonth = open.month === 1 ? 12 : open.month - 1;
  const prevYear = open.month === 1 ? open.year - 1 : open.year;
  const prev = await prisma.period.findUnique({ where: { householdId_year_month: { householdId: h.id, year: prevYear, month: prevMonth } } });

  const members = await prisma.member.findMany({ where: { householdId: h.id }, select: { id: true, name: true } });
  const nameOf = (id: number | null) => members.find((m) => m.id === id)?.name ?? (id == null ? "—" : `#${id}`);

  const [incomes, allExpenses, spends, records] = await Promise.all([
    prisma.incomeEntry.findMany({ where: { periodId: open.id }, select: { ownerId: true, amount: true } }),
    prisma.expenseEntry.findMany({ where: { periodId: open.id }, include: { category: { select: { name: true, responsibleMemberId: true, section: true, isAllowance: true } } } }),
    prisma.spend.findMany({ where: { periodId: prev?.id ?? -1 }, include: { category: { select: { name: true, responsibleMemberId: true, section: true } } } }),
    prisma.settlementRecord.findMany({ where: { periodId: open.id }, orderBy: { settledAt: "asc" } }),
  ]);

  const expenses = allExpenses
    .filter((e) => e.note !== "__carry__" && e.note !== "__deferred__" && !e.category.isAllowance)
    .map((e) => ({ memberId: e.memberId, amount: e.amount, label: e.label, category: { name: e.category.name, responsibleMemberId: e.category.responsibleMemberId, section: e.category.section } }));
  const spendsIn = spends.map((s) => ({ memberId: s.memberId, amount: s.amount, label: s.label, category: { name: s.category.name, responsibleMemberId: s.category.responsibleMemberId, section: s.category.section } }));

  const settlement = computeSettlement({
    members, incomes, expenses, spends: spendsIn, records,
    treasurerId, prevLabel: prev?.label ?? null,
  });

  console.log(`\n╔══ MONEY-PLAN SETTLEMENT TRACE · ${h.name} · ${open.label} (treasurer = ${nameOf(treasurerId)}) ══╗\n`);

  console.log("── SettlementRecords on file (the money IS recorded here) ──");
  if (records.length === 0) console.log("  (none)");
  for (const r of records) {
    console.log(`  ${nameOf(r.fromMemberId).padEnd(10)} → ${nameOf(r.toMemberId).padEnd(10)} ${inr(r.amount).padStart(11)}   settled ${r.settledAt.toISOString().slice(0, 16).replace("T", " ")}${r.settledById ? ` by ${nameOf(r.settledById)}` : ""}`);
  }

  console.log("\n── Each member's LIVE net (contributed − paid) — drives whether a transfer still renders ──");
  for (const row of settlement.rows) {
    if (row.id === treasurerId) continue;
    const renders = Math.abs(row.net) >= 0.005;
    console.log(`  ${row.name.padEnd(10)} contributed ${inr(row.contributed).padStart(11)}  paid ${inr(row.paid).padStart(11)}  net ${inr(row.net).padStart(11)}  ${renders ? "→ renders a transfer" : "→ NET ~0, no transfer renders"}`);
  }

  console.log("\n── Currently RENDERING transfers in the plan ──");
  for (const t of settlement.transfers) {
    console.log(`  ${t.from.padEnd(10)} → ${t.to.padEnd(10)} ${inr(t.amount).padStart(11)}  ${t.settled ? `✓ done (recorded ${inr(t.paidAmount ?? t.amount)})` : "○ pending"}`);
  }

  // Orphaned records: a record whose (from,to) pair has NO matching live transfer → the vanished step.
  console.log("\n── ⚠ ORPHANED records (marked done, but NO live transfer renders → VANISHED from the plan) ──");
  let anyOrphan = false;
  for (const r of records) {
    const match = settlement.transfers.find(
      (t) => (t.fromId === r.fromMemberId && t.toId === r.toMemberId) || (t.fromId === r.toMemberId && t.toId === r.fromMemberId),
    );
    if (!match) {
      anyOrphan = true;
      console.log(`  ${nameOf(r.fromMemberId)} → ${nameOf(r.toMemberId)}  ${inr(r.amount)}  (settled ${r.settledAt.toISOString().slice(0, 16).replace("T", " ")}) — recorded, money accounted, but the step no longer shows.`);
    }
  }
  if (!anyOrphan) console.log("  (none — every record still has a visible transfer)");
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
