import { prisma } from "@/lib/prisma";
import { clonePeriodInto } from "@/lib/periodClone";

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
        await clonePeriodInto(tx, latest.id, p.id, h.id);
      } else {
        // first-ever period: seed budgets from the template (Budget categories only)
        const cats = await tx.category.findMany({
          where: { householdId: h.id, monthlyBudget: { not: null }, onHold: false, fixed: false },
        });
        for (const c of cats) await tx.budget.create({ data: { periodId: p.id, categoryId: c.id, planned: c.monthlyBudget! } });
      }
    });
    created.push(`household ${h.id}: ${label}`);
  }
  return { year, month, label, created };
}
