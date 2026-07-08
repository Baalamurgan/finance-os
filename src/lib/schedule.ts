// Recurring-item scheduling (pure, dependency-free → unit-testable and client-safe).
//
// An item is anchored by (installmentStartYear, installmentStartMonth) and repeats every
// `intervalMonths`. It is DUE in a target month when the number of whole months since the
// anchor is a non-negative multiple of the interval, and (if capped) within the occurrence
// count. No anchor = plain "every month".
//
//   every month  → start = null                       (interval ignored)
//   installment  → interval 1, start set, total = N    (EMI: N consecutive months)
//   periodic     → interval N (2/6/12…), start = first-due month, total = null | N

export type Schedule = {
  intervalMonths?: number | null;
  installmentsTotal?: number | null; // occurrence cap (null = forever)
  installmentStartYear?: number | null;
  installmentStartMonth?: number | null;
};

/** Is this item due in the given month, and if so which occurrence number (1-based)? */
export function scheduleOccurrence(
  sched: Schedule,
  period: { year: number; month: number },
): { due: boolean; n: number | null } {
  const sy = sched.installmentStartYear;
  const sm = sched.installmentStartMonth;
  if (sy == null || sm == null) return { due: true, n: null }; // no anchor → every month
  const interval = Math.max(1, Math.round(sched.intervalMonths ?? 1));
  const delta = (period.year - sy) * 12 + (period.month - sm); // whole months since anchor
  if (delta < 0) return { due: false, n: null }; // before it starts
  if (delta % interval !== 0) return { due: false, n: null }; // not a due month
  const n = delta / interval + 1;
  if (sched.installmentsTotal != null && n > sched.installmentsTotal) return { due: false, n }; // past the last one
  return { due: true, n };
}

/** The generated line label — "name N/total" for capped runs, plain name otherwise. */
export function scheduleLabel(name: string, total: number | null | undefined, n: number | null): string {
  return total != null && n != null ? `${name} ${n}/${total}` : name;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short human summary of a PERIODIC schedule (interval>1), else null. Installments are
 *  shown separately as their "N/total" tag. e.g. "yearly · 1 Jul", "every 2 months". */
export function scheduleSummary(s: {
  intervalMonths?: number | null;
  installmentStartMonth?: number | null;
  dueDay?: number | null;
}): string | null {
  const iv = s.intervalMonths ?? 1;
  if (iv <= 1) return null;
  const every =
    iv === 12 ? "yearly" : iv === 6 ? "half-yearly" : iv === 3 ? "quarterly" : iv === 2 ? "every 2 months" : `every ${iv} mo`;
  const mon = s.installmentStartMonth ? MON[s.installmentStartMonth - 1] : null;
  const day = s.dueDay ? `${s.dueDay} ` : "";
  return mon ? `${every} · ${day}${mon}` : every;
}
