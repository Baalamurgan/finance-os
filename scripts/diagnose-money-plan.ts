/**
 * READ-ONLY: dump the inputs that drive the money-plan funding engine for the live draft (Oct),
 * so we can see WHY a member's bill isn't being funded by a hub/peer transfer. Shows each member's
 * settlement net (does the hub owe them?), their income arrival days, and their dated bills — plus
 * the hub's cash timeline. Nothing is written.
 *
 * Run: node_modules/.bin/tsx scripts/diagnose-money-plan.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { computeSettlement } from "../src/lib/settlement-core";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function main() {
  const period = await prisma.period.findFirst({ where: { status: "draft" }, orderBy: [{ year: "desc" }, { month: "desc" }] });
  if (!period) { console.log("No draft period."); return; }
  const hh = period.householdId;
  const household = await prisma.household.findUnique({ where: { id: hh }, select: { treasurerMemberId: true } });
  const treasurerId = period.treasurerMemberId ?? household?.treasurerMemberId ?? null;
  const members = await prisma.member.findMany({ where: { householdId: hh }, orderBy: { id: "asc" }, select: { id: true, name: true } });
  const nameOf = (id: number | null) => members.find((m) => m.id === id)?.name ?? "—";
  console.log(`=== Money-plan inputs · ${period.label} (draft) · treasurer=${nameOf(treasurerId)} ===\n`);

  const prevMonth = period.month === 1 ? 12 : period.month - 1;
  const prevYear = period.month === 1 ? period.year - 1 : period.year;
  const prev = await prisma.period.findUnique({ where: { householdId_year_month: { householdId: hh, year: prevYear, month: prevMonth } } });

  const [incomes, allExpenses, spends, records] = await Promise.all([
    prisma.incomeEntry.findMany({ where: { periodId: period.id } }),
    prisma.expenseEntry.findMany({ where: { periodId: period.id }, include: { category: true }, orderBy: { id: "asc" } }),
    prisma.spend.findMany({ where: { periodId: prev?.id ?? -1 }, include: { category: true } }),
    prisma.settlementRecord.findMany({ where: { periodId: period.id } }),
  ]);
  const budgets = await prisma.budget.findMany({ where: { periodId: period.id } });
  const budgetedIds = new Set(budgets.filter((b) => b.planned > 0).map((b) => b.categoryId));

  const expenses = allExpenses.filter((e) => e.note !== "__carry__" && e.note !== "__deferred__" && e.note !== "__pool__" && e.note !== "__poolbill__" && e.note !== "__removed__" && !e.category.isAllowance);
  const st = computeSettlement({ members, incomes, expenses, spends, records, treasurerId, prevLabel: prev?.label ?? null });

  console.log("Per-member settlement net (>0 pays hub · <0 hub owes them):");
  for (const r of st.rows) console.log(`  ${r.name.padEnd(10)} net=${inr(r.net).padStart(10)}  (income ${inr(r.contributed)} − tagged ${inr(r.paid)})`);
  console.log("\nTransfers (settlement):");
  for (const t of st.transfers) console.log(`  ${t.from} → ${t.to}: ${inr(t.amount)}`);

  console.log("\nPer-member income arrivals & dated bills (timing):");
  for (const m of members) {
    const inc = incomes.filter((i) => i.ownerId === m.id).map((i) => ({ day: i.dueDay, amount: i.amount }));
    // "cash bills" the member pays: dated, tagged, not a budgeted envelope, not a fund set-aside/allowance
    const bills = allExpenses.filter((e) =>
      e.memberId === m.id && e.note == null && e.category.fundingStyle == null && !e.category.isAllowance &&
      (!e.category.tracked || e.category.section === "Misc" || (e.category.section === "Monthly" && (e as { category: { miscCard?: boolean } }).category.miscCard)) &&
      !budgetedIds.has(e.categoryId));
    const budgetedLines = allExpenses.filter((e) => e.memberId === m.id && budgetedIds.has(e.categoryId));
    if (inc.length === 0 && bills.length === 0 && budgetedLines.length === 0) continue;
    console.log(`\n  ── ${m.name}${m.id === treasurerId ? " (treasurer)" : ""} ──`);
    if (inc.length) console.log(`     income: ${inc.map((i) => `day ${i.day ?? "?"} ${inr(i.amount)}`).join(", ")}`);
    for (const b of bills) console.log(`     bill:  day ${b.dueDay ?? "—"}  ${inr(b.amount)}  "${b.label}"  [${b.category.section}]`);
    for (const b of budgetedLines) console.log(`     budgeted envelope: ${inr(b.amount)} "${b.label}" (not a cash bill)`);
  }

  console.log("\n(Read: a member with a dated bill BEFORE their income arrives, whose net is >0 (pays the hub) or 0,");
  console.log(" won't get a hub/peer disbursement today — the engine only funds members the hub already owes.)");
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
