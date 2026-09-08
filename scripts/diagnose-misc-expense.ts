import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// READ-ONLY. For each large/marked expense line in every OPEN month, print the exact fields that decide
// whether it becomes a Money-Plan step, and the VERDICT of the two plan queries:
//   • bill step   ("Baala pays X")      — getInHand billLines: note=null AND category.fundingStyle=null
//                                          AND !isAllowance AND (tracked=false OR section=Misc), and the
//                                          category isn't budgeted (Budget.planned>0).
//   • allowance/pool step ("hub → member") — allowanceLines: (note=null AND category.isAllowance)
//                                          OR note=__pool__.
// Anything that matches NEITHER is a Sheet line with no plan step. Run: node_modules/.bin/tsx scripts/diagnose-misc-expense.ts
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const POOL_NOTE = "__pool__";

async function main() {
  const h = await prisma.household.findFirst({ select: { id: true } });
  if (!h) return console.log("no household");
  const periods = await prisma.period.findMany({ where: { householdId: h.id, status: "open" }, select: { id: true, label: true }, orderBy: [{ year: "asc" }, { month: "asc" }] });
  const members = await prisma.member.findMany({ where: { householdId: h.id }, select: { id: true, name: true } });
  const nm = (id: number | null) => (id == null ? "Shared" : members.find((m) => m.id === id)?.name ?? `#${id}`);

  for (const p of periods) {
    console.log(`\n━━ ${p.label} (open) ━━`);
    const exps = await prisma.expenseEntry.findMany({
      where: { periodId: p.id, OR: [{ amount: { gte: 5000 } }, { note: { not: null } }, { label: { contains: "chit" } }, { label: { contains: "Thatha" } }] },
      select: { id: true, label: true, amount: true, memberId: true, dueDay: true, note: true, oneOff: true, pinned: true, paid: true, categoryId: true, category: { select: { name: true, section: true, isAllowance: true, tracked: true, fundingStyle: true } } },
      orderBy: { amount: "desc" },
    });
    if (exps.length === 0) { console.log("  (no large / marked expense lines)"); continue; }
    const budgets = await prisma.budget.findMany({ where: { periodId: p.id }, select: { categoryId: true, planned: true } });
    const budgetedIds = new Set(budgets.filter((b) => b.planned > 0).map((b) => b.categoryId));
    for (const e of exps) {
      const c = e.category;
      const isBudgeted = budgetedIds.has(e.categoryId);
      const billStep = e.note == null && c.fundingStyle == null && !c.isAllowance && (c.tracked === false || c.section === "Misc") && !isBudgeted;
      const allowanceStep = (e.note == null && c.isAllowance) || e.note === POOL_NOTE;
      const verdict = billStep ? "→ BILL step (member pays)" : allowanceStep ? "→ ALLOWANCE/POOL step (hub → member)" : "✗ NO plan step";
      console.log(`\n  ₹${e.amount}  “${e.label}”  → ${nm(e.memberId)}   due=${e.dueDay ?? "—"}  paid=${e.paid}`);
      console.log(`     category="${c.name}" section=${c.section} tracked=${c.tracked} isAllowance=${c.isAllowance} fundingStyle=${c.fundingStyle ?? "—"} budgeted=${isBudgeted}`);
      console.log(`     note=${e.note ?? "null"} pinned=${e.pinned} oneOff=${e.oneOff}   ${verdict}`);
    }
  }
  console.log("");
}

main().finally(() => prisma.$disconnect());
