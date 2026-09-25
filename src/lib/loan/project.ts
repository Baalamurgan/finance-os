// Bridges the pure amortization engine to a persisted loan: given a loan's master fields + its current
// ACTUAL outstanding (ground truth), produce the forward-looking projection (remaining schedule, interest
// remaining, closure date) and the reference original-term figures. Pure & testable — takes a plain
// object, touches no DB. Planned prepayments (from linked Spend lines) are passed in by the caller.

import { amortize, emiFor, isoAddMonths, round2, type AmortResult, type Prepayment, type EmiOverride } from "./amortize";

export type LoanLike = {
  originalPrincipal: number | null;
  outstanding: number; // ACTUAL current balance (ground truth)
  interestRate: number | null; // annual %
  originalTenureMonths: number | null;
  emiAmount: number | null;
  monthlyAmount: number;
  startDate: Date | string | null;
  interestOnly?: boolean; // gold/jewel loan — no amortization schedule
};

export type LoanProjection = {
  emi: number;
  annualRatePct: number;
  originalPrincipal: number | null;
  currentOutstanding: number;
  principalPaid: number | null; // original − outstanding (null if original unknown)
  originalTenureMonths: number | null;
  elapsedMonths: number;
  remainingMonths: number;
  totalInterestRemaining: number;
  closureDate: string | null;
  originalClosureDate: string | null;
  schedule: AmortResult["rows"]; // forward rows from the current outstanding
  interestOnly: boolean; // payment ≈ interest → balance ~flat; schedule is a capped horizon, doesn't close
};

// A loan is "amortizable" (gets the engine treatment) once it has a rate + principal + (EMI or tenure).
// Otherwise it stays the legacy manual tracker / chit.
export function isAmortizable(l: LoanLike): boolean {
  const emi = (l.emiAmount ?? l.monthlyAmount) || 0;
  const principal = (l.originalPrincipal ?? l.outstanding) || 0;
  return l.interestRate != null && l.interestRate > 0 && principal > 0 && (emi > 0 || (l.originalTenureMonths ?? 0) > 0);
}

// Whole months elapsed from start to asOf (not counting a month until its day-of-month is reached).
function monthsBetween(start: Date, asOf: Date): number {
  let m = (asOf.getFullYear() - start.getFullYear()) * 12 + (asOf.getMonth() - start.getMonth());
  if (asOf.getDate() < start.getDate()) m -= 1;
  return Math.max(0, m);
}

// Build a local Date `k` months after `start`, with the day clamped to the target month's length.
function addMonthsLocal(start: Date, k: number): Date {
  const [y, m, d] = isoAddMonths(start, k).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function projectLoan(l: LoanLike, opts?: { asOf?: Date; plannedPrepayments?: Prepayment[]; emiOverrides?: EmiOverride[] }): LoanProjection | null {
  if (!isAmortizable(l)) return null;
  const rate = l.interestRate as number;
  const asOf = opts?.asOf ?? new Date();
  const originalPrincipal = l.originalPrincipal ?? null;
  const start = l.startDate ? new Date(l.startDate) : null;
  const emi = (l.emiAmount ?? l.monthlyAmount) || emiFor(originalPrincipal ?? l.outstanding, rate, l.originalTenureMonths ?? 0);
  const opening = l.outstanding > 0 ? l.outstanding : originalPrincipal ?? 0;
  const elapsed = start ? monthsBetween(start, asOf) : 0;
  const forwardStart = start ? addMonthsLocal(start, elapsed) : null;

  // Run out to a long detection cap (never throws). If it clears the balance, it's an amortizing loan and
  // we show the full run to closure. If it doesn't clear within the cap, the payment ≈ interest (gold/jewel
  // interest-only): mark it interest-only and show a shorter flat horizon in the SAME table format. The
  // what-if still lets you add prepayments / bigger EMIs to see the balance actually drop.
  const DETECT_CAP = 600;
  const HORIZON = 60;
  const forwardFull = amortize({
    principal: opening,
    annualRatePct: rate,
    emi,
    startDate: forwardStart,
    startIndex: elapsed + 1,
    prepayments: opts?.plannedPrepayments ?? [],
    emiOverrides: opts?.emiOverrides ?? [],
    maxMonths: DETECT_CAP,
  });
  const closes = forwardFull.rows.length > 0 && forwardFull.rows[forwardFull.rows.length - 1].balance <= 0.005;
  const interestOnly = !closes;
  const rows = interestOnly ? forwardFull.rows.slice(0, HORIZON) : forwardFull.rows;
  const totalInterestRemaining = interestOnly ? round2(rows.reduce((s, r) => s + r.interest, 0)) : forwardFull.totalInterest;

  let originalClosureDate: string | null = null;
  if (!interestOnly && originalPrincipal && (l.originalTenureMonths || emi)) {
    originalClosureDate = amortize({ principal: originalPrincipal, annualRatePct: rate, emi, startDate: start, maxMonths: DETECT_CAP }).closureDate;
  }

  return {
    emi: round2(emi),
    annualRatePct: rate,
    originalPrincipal,
    currentOutstanding: l.outstanding,
    principalPaid: originalPrincipal != null ? round2(originalPrincipal - l.outstanding) : null,
    originalTenureMonths: l.originalTenureMonths ?? null,
    elapsedMonths: elapsed,
    remainingMonths: closes ? rows.length : 0, // 0 = doesn't close on its own (interest-only)
    totalInterestRemaining,
    closureDate: closes ? forwardFull.closureDate : null,
    originalClosureDate,
    schedule: rows,
    interestOnly,
  };
}
