import { prisma } from "@/lib/prisma";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];


// Non-destructive: ensures the current calendar month exists for every household,
// cloned from the latest period (income≥0 + expenses skipping onHold + budgets).
// Does NOT close any prior month. Shared by the local script and the Vercel cron route.
export async function ensureCurrentMonth(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const label = `${MONTHS[month - 1]} ${year}`;
  const households = await prisma.household.findMany({ select: { id: true } });
  const created: string[] = [];

  for (const h of households) {
    const existing = await prisma.period.findUnique({
      where: { householdId_year_month: { householdId: h.id, year, month } },
    });
    if (existing) continue;

    const latest = await prisma.period.findFirst({
      where: { householdId: h.id },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });

    await prisma.$transaction(async (tx) => {
      const p = await tx.period.create({ data: { householdId: h.id, year, month, label } });
      if (latest) {
        const [incomes, expenses, cats] = await Promise.all([
          tx.incomeEntry.findMany({ where: { periodId: latest.id, oneOff: false } }),
          // oneOff carries (misc / over-budget) are not copied forward
          tx.expenseEntry.findMany({ where: { periodId: latest.id, oneOff: false } }),
          tx.category.findMany({
            where: { householdId: h.id },
            select: { id: true, name: true, sinking: true, monthlyBudget: true, necessary: true, onHold: true },
          }),
        ]);
        const held = new Set(cats.filter((c) => c.onHold).map((c) => c.id));
        // sinking sheet share lines come from the CURRENT template (see clonePeriodStructure)
        const sinkingCats = cats.filter(
          (c) => c.sinking && !c.onHold && c.monthlyBudget != null && c.monthlyBudget > 0,
        );
        const sinkingIds = new Set(sinkingCats.map((c) => c.id));
        for (const i of incomes) {
          if (i.amount < 0) continue;
          await tx.incomeEntry.create({ data: { periodId: p.id, source: i.source, amount: i.amount, ownerId: i.ownerId } });
        }
        for (const e of expenses) {
          if (held.has(e.categoryId)) continue;
          if (sinkingIds.has(e.categoryId)) continue; // replaced by a canonical share line below
          await tx.expenseEntry.create({
            data: { periodId: p.id, label: e.label, amount: e.amount, categoryId: e.categoryId, memberId: e.memberId, necessary: e.necessary },
          });
        }
        for (const c of sinkingCats) {
          await tx.expenseEntry.create({
            data: { periodId: p.id, categoryId: c.id, label: `${c.name} (monthly share)`, amount: c.monthlyBudget!, necessary: c.necessary },
          });
        }
      }
      const cats = await tx.category.findMany({ where: { householdId: h.id, monthlyBudget: { not: null }, onHold: false } });
      for (const c of cats) await tx.budget.create({ data: { periodId: p.id, categoryId: c.id, planned: c.monthlyBudget! } });
    });
    created.push(`household ${h.id}: ${label}`);
  }
  return { year, month, label, created };
}
