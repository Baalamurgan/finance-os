import { prisma } from "@/lib/prisma";
import { generateMonth } from "@/lib/periodClone";
import { windDownPeriod } from "@/lib/windDown";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// The family's month boundary is IST (UTC+5:30), not the server's UTC — a spend at 11pm IST
// on the 31st is still that month. Same helper as actions.ts::istYearMonth.
function istYearMonth(now: Date) {
  const ist = new Date(now.getTime() + 330 * 60000);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1 };
}

// Auto month-end CLOSE: wind down any month still OPEN whose IST calendar month has fully
// elapsed (on Aug 1 IST, close July). This automates the manual "press Wind Down" step — the
// head still gets a countdown reminder and can close early via the button. Oldest-first so
// carry-forward chains correctly if several months were left open. leftoversToIncome = false
// parks under-budget leftovers in Piggy (the household default; no human ticks the box here).
// windDownPeriod is idempotent (bails unless status === "open"), so re-runs are safe.
export async function autoCloseElapsedMonths(now = new Date()) {
  const { year, month } = istYearMonth(now);
  const cutoff = year * 12 + month; // periods strictly before this are elapsed
  const openPeriods = await prisma.period.findMany({
    where: { status: "open" },
    select: { id: true, year: true, month: true, label: true },
  });
  const toClose = openPeriods
    .filter((p) => p.year * 12 + p.month < cutoff)
    .sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  const closed: string[] = [];
  for (const p of toClose) {
    await windDownPeriod(p.id, { leftoversToIncome: false });
    closed.push(p.label);
  }
  return closed;
}


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
