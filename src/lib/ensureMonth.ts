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
    // The "working month" = any OTHER month still open. While one exists, the current calendar
    // month must stay a PREVIEW draft — it only goes live when that month winds down
    // (windDownMonth) or, if nothing is open, right here. This keeps the next-month preview
    // (projected Piggy, surplus estimate) intact through the wind-down window: e.g. the calendar
    // rolls to Aug 1 but the household winds down on the 5th, so Aug stays a preview until then.
    const openElsewhere = await prisma.period.findFirst({
      where: { householdId: h.id, status: "open", NOT: { year, month } },
      select: { id: true },
    });

    const existing = await prisma.period.findUnique({
      where: { householdId_year_month: { householdId: h.id, year, month } },
    });
    if (existing) {
      if (existing.status === "draft" && !openElsewhere) {
        // the preview draft became the current month AND nothing earlier is still open → go live
        await prisma.period.update({ where: { id: existing.id }, data: { status: "open" } });
        created.push(`household ${h.id}: ${label} (promoted draft)`);
      } else if (existing.status === "open" && openElsewhere) {
        // Self-heal a month promoted too early (before the prior month wound down), which left two
        // open months and hid the preview. Safe only when it has no real activity yet — its
        // generated rows ride along fine as a draft, and wind-down will re-promote it properly.
        const activity =
          (await prisma.spend.count({ where: { periodId: existing.id } })) +
          (await prisma.settlementRecord.count({ where: { periodId: existing.id } })) +
          (await prisma.piggyEntry.count({ where: { periodId: existing.id } }));
        if (activity === 0) {
          await prisma.period.update({ where: { id: existing.id }, data: { status: "draft" } });
          created.push(`household ${h.id}: ${label} (demoted to preview — earlier month still open)`);
        }
      }
      continue;
    }

    // Doesn't exist yet → create it. Go live immediately only if nothing earlier is open;
    // otherwise it's the next-month preview draft until the working month winds down.
    await prisma.$transaction(async (tx) => {
      const p = await tx.period.create({ data: { householdId: h.id, year, month, label, status: openElsewhere ? "draft" : "open" } });
      // months are generated from the RecurringItem template (source of truth)
      await generateMonth(tx, p.id, h.id);
    });
    created.push(`household ${h.id}: ${label}${openElsewhere ? " (preview draft)" : ""}`);
  }
  return { year, month, label, created };
}
