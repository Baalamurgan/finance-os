import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { planBillMonth, isLumpDue, monthsUntilNextDue, type FundingStyle } from "../src/lib/schedule";

// READ-ONLY. For every "bill with a fund" category (fundingStyle set), prints the SETUP that drives its
// monthly share + due-month bill, the accrued fund, and what planBillMonth computes for the next 12
// months — so you can see exactly why a month shows the share/amount it does. Answers "setup or logic":
// if the printed inputs match your intent, the logic is right; if an input (billAmount / billEveryMonths
// / billMonth / fundingStyle / saveEveryMonths / monthlyBudget) is wrong, it's a Setup fix.
// Run:  npx tsx scripts/diagnose-fund-bills.ts
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function main() {
  const h = await prisma.household.findFirst({ select: { id: true, name: true } });
  if (!h) return console.log("no household");

  const cats = await prisma.category.findMany({
    where: { householdId: h.id, fundingStyle: { not: null } },
    select: { id: true, name: true, fundingStyle: true, billAmount: true, billMonth: true, billEveryMonths: true, saveEveryMonths: true, monthlyBudget: true, onHold: true, responsibleMemberId: true, payerMemberId: true, onUnpaid: true },
    orderBy: { name: "asc" },
  });
  if (cats.length === 0) return console.log("No bill-with-a-fund categories.");

  const funds = await prisma.piggyEntry.groupBy({ by: ["categoryId"], where: { householdId: h.id, kind: "sinking" }, _sum: { amount: true } });
  const fundByCat = new Map<number, number>();
  for (const f of funds) if (f.categoryId != null) fundByCat.set(f.categoryId, f._sum.amount ?? 0);

  for (const c of cats) {
    const fund = Math.round((fundByCat.get(c.id) ?? 0) * 100) / 100;
    console.log(`\n━━ ${c.name}${c.onHold ? "  (ON HOLD)" : ""} ━━`);
    console.log(`  fundingStyle=${c.fundingStyle}  billAmount=${c.billAmount}  billEveryMonths=${c.billEveryMonths} (${c.billEveryMonths === 1 ? "monthly" : c.billEveryMonths === 2 ? "every 2 months" : c.billEveryMonths === 12 ? "yearly" : `every ${c.billEveryMonths} mo`})`);
    console.log(`  billMonth=${c.billMonth}${c.billMonth ? ` (${MON[(c.billMonth - 1) % 12]})` : ""}  saveEveryMonths=${c.saveEveryMonths ?? 1}  fixedShare(monthlyBudget)=${c.monthlyBudget}  onUnpaid=${c.onUnpaid}`);
    console.log(`  accrued fund now = ₹${fund}`);
    if (c.billAmount == null || c.billMonth == null || c.billEveryMonths == null) { console.log("  ⚠ incomplete setup (billAmount/billMonth/billEveryMonths missing) — won't generate."); continue; }

    console.log(`  month-by-month (fund shown does NOT roll forward here — just this month's decision):`);
    for (let m = 1; m <= 12; m++) {
      const due = isLumpDue(c.billMonth, c.billEveryMonths, { month: m });
      const plan = planBillMonth({
        billAmount: c.billAmount, billMonth: c.billMonth, everyMonths: c.billEveryMonths,
        fund, fundingStyle: c.fundingStyle as FundingStyle, fixedShare: c.monthlyBudget, saveEveryMonths: c.saveEveryMonths, month: m,
      });
      const left = due ? 0 : monthsUntilNextDue(c.billMonth, c.billEveryMonths, m);
      const desc =
        plan.kind === "save" ? `set aside ₹${plan.contribution} (monthly share)` :
        plan.kind === "bill" ? `BILL ₹${plan.bill}  (from fund ₹${plan.fromFund}, out-of-pocket ₹${plan.outOfPocket})` :
        "nothing";
      console.log(`    ${MON[m - 1]}: ${due ? "DUE" : `save (${left} mo to due)`} → ${desc}`);
    }
  }
  console.log("");
}

main().finally(() => prisma.$disconnect());
