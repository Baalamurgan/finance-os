// GUIDED ONE-OFF MIGRATION (run manually, against PROD). The Sheet's "Salary" box (PersonalPeriod.income) +
// its "Lands in" account are gone — salary now lives in Setup as a RECURRING INCOME, which the Money Plan
// turns into a "received" step every month. This moves any salary still stored in that field into Setup:
//   • for every OPEN/DRAFT personal month with income > 0 → create a recurring "Salary" income row (same
//     amount, landing in the month's old "Lands in" account) and zero the old field (totals are unchanged);
//   • the old "Salary received" plan step is replaced by the new income step, keeping its done/removed state
//     (a ticked one keeps its account credit — the ledger line is re-pointed at the new income row).
// Closed months are history and are left alone. Months that already have a recurring "Salary" row are skipped.
//
// RUN from the repo root:
//   export DATABASE_URL=$(grep '^DIRECT_URL=' .env.local.prod-backup | cut -d= -f2- | tr -d '"')
//   npx tsx scripts/move-salary-to-setup.ts            # dry run — prints what it would do
//   npx tsx scripts/move-salary-to-setup.ts --apply    # does it (one transaction per month)
// Delete this file once run.
import { prisma } from "@/lib/prisma";

const apply = process.argv.includes("--apply");
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function main() {
  const periods = await prisma.personalPeriod.findMany({
    where: { status: { in: ["open", "draft"] }, income: { gt: 0 } },
    orderBy: [{ memberId: "asc" }, { year: "asc" }, { month: "asc" }],
    include: { member: { select: { name: true } } },
  });
  if (periods.length === 0) return console.log("Nothing to move — no open/draft month has a stored salary.");
  for (const p of periods) {
    const label = `${p.member.name} · ${p.label} (${p.status})`;
    const dup = await prisma.personalIncome.findFirst({ where: { periodId: p.id, recurring: true, source: { equals: "Salary", mode: "insensitive" } }, select: { id: true } });
    if (dup) { console.log(`SKIP  ${label}: already has a recurring Salary income (#${dup.id}); stored ${inr(p.income)} NOT moved — resolve by hand.`); continue; }
    const baseStep = await prisma.personalPlanStep.findFirst({ where: { periodId: p.id, templateKind: "baseincome" } });
    console.log(`MOVE  ${label}: ${inr(p.income)} → recurring "Salary" income${p.incomeAccountId ? ` into account #${p.incomeAccountId}` : " (budget only)"}${baseStep ? ` · old step: ${baseStep.status}` : ""}`);
    if (!apply) continue;
    await prisma.$transaction(async (tx) => {
      const inc = await tx.personalIncome.create({
        data: { memberId: p.memberId, periodId: p.id, source: "Salary", amount: p.income, date: new Date(p.year, p.month - 1, 1), recurring: true, accountId: p.incomeAccountId },
      });
      await tx.personalPeriod.update({ where: { id: p.id }, data: { income: 0 } });
      if (baseStep) {
        if (baseStep.status === "done") {
          // keep the account credit already posted: re-point its ledger line at the new income row
          await tx.accountTransaction.updateMany({ where: { memberId: p.memberId, category: `__baseincome__:${p.id}` }, data: { personalIncomeId: inc.id, category: null } });
        }
        await tx.personalPlanStep.delete({ where: { id: baseStep.id } });
        if (baseStep.status === "done" || baseStep.status === "skipped") {
          await tx.personalPlanStep.create({
            data: { memberId: p.memberId, periodId: p.id, kind: "income", label: "Salary", amount: p.income, dayOfMonth: baseStep.dayOfMonth, toAccountId: p.incomeAccountId, method: baseStep.method, position: baseStep.position, templateKind: "income", templateId: inc.id, status: baseStep.status, doneAt: baseStep.doneAt, sortOrder: baseStep.sortOrder },
          });
        }
      }
    });
    console.log(`      done ✓`);
  }
  if (!apply) console.log("\nDRY RUN — nothing changed. Re-run with --apply.");
}
main().finally(() => prisma.$disconnect());
