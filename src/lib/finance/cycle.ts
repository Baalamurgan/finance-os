import type { BillingCycle } from "./types";

const dayOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * The in-progress billing cycle for a credit card, derived purely from its statement
 * day (no Statement entity needed). A statement dated D closes the cycle that runs from
 * the day AFTER the previous statement through D — e.g. statementDay 15, "16 May → 15 Jun".
 *
 * The *current* cycle is the one that will close on the next statement date on/after today.
 * statementDay is clamped to 1–28 so month arithmetic is always safe (no Feb overflow).
 */
export function currentCycle(
  statementDay: number,
  now: Date,
  dueOffsetDays?: number | null,
): BillingCycle {
  const D = Math.min(28, Math.max(1, Math.round(statementDay)));
  const today = dayOnly(now);

  // statement date = the next occurrence of day D on/after today
  let endY = today.getFullYear();
  let endM = today.getMonth(); // 0-based
  if (today.getDate() > D) {
    endM += 1;
    if (endM > 11) { endM = 0; endY += 1; }
  }
  const end = new Date(endY, endM, D);

  // cycle start = day after the previous statement date (one month before `end`)
  let pmY = endY, pmM = endM - 1;
  if (pmM < 0) { pmM = 11; pmY -= 1; }
  const prevStatement = new Date(pmY, pmM, D);
  const start = new Date(prevStatement.getFullYear(), prevStatement.getMonth(), prevStatement.getDate() + 1);

  const dueDate =
    dueOffsetDays != null ? new Date(end.getFullYear(), end.getMonth(), end.getDate() + dueOffsetDays) : null;

  return { start, end, statementDate: end, dueDate };
}
