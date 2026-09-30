import { prisma } from "@/lib/prisma";
import { generateMonth } from "@/lib/periodClone";
import { windDownPeriod } from "@/lib/windDown";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// The family's month boundary is IST (UTC+5:30), not the server's UTC — a spend at 11pm IST
// on the 31st is still that month. Same basis as actions.ts::istYearMonth.
function istParts(now: Date) {
  const ist = new Date(now.getTime() + 330 * 60000);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1,
    day: ist.getUTCDate(),
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
  };
}

// Last calendar day of a 1-based IST month (28–31). Day 0 of the next month = last day of this one.
function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Auto month-end CLOSE: wind down any month still OPEN whose IST calendar month has fully
// elapsed (on Aug 1 IST, close July) AND — the "wind down at 11:59pm" rule — the current month
// once it reaches 23:59 IST on its last calendar day (so July closes at 11:59pm July 31, not at
// 2:30pm Aug 1). If a run lands a minute late (already past midnight), the month is simply elapsed
// and closes anyway, so the boundary is covered either way. This automates the manual "press Wind
// Down" step — the head still gets a countdown reminder and can close early via the button.
// Oldest-first so carry-forward chains correctly if several months were left open. leftoversToIncome
// = false parks under-budget leftovers in Piggy (the household default; no human ticks the box here).
// windDownPeriod is idempotent (bails unless status === "open"), so re-runs are safe.
export async function autoCloseElapsedMonths(now = new Date()) {
  const { year, month, day, hour, minute } = istParts(now);
  // At/after 23:59 IST on the last day, the current month is due to close too — pull the cutoff
  // forward one month so it's included alongside any already-elapsed months.
  const atMonthEnd = day === lastDayOfMonth(year, month) && (hour > 23 || (hour === 23 && minute >= 59));
  const cutoff = atMonthEnd ? year * 12 + month + 1 : year * 12 + month; // periods strictly before this are elapsed
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
  // IST, not the server's UTC clock — otherwise "the current month" lags 5.5h and the new month
  // isn't created/promoted until ~5:30am IST on the 1st (matches autoCloseElapsedMonths above).
  const { year, month } = istParts(now);
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
