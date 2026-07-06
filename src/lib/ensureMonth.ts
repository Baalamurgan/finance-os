import { prisma } from "@/lib/prisma";
import { generateMonth } from "@/lib/periodClone";

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
    if (existing) {
      // a preview draft became the current month → promote it to a real open month
      if (existing.status === "draft") {
        await prisma.period.update({ where: { id: existing.id }, data: { status: "open" } });
        created.push(`household ${h.id}: ${label} (promoted draft)`);
      }
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const p = await tx.period.create({ data: { householdId: h.id, year, month, label } });
      // months are generated from the RecurringItem template (source of truth)
      await generateMonth(tx, p.id, h.id);
    });
    created.push(`household ${h.id}: ${label}`);
  }
  return { year, month, label, created };
}
