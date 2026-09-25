// ── Loan amortization engine (PLANNING calculation) ─────────────────────────────────────────────────
//
// Model: standard MONTHLY reducing-balance amortization.
//   • monthly rate  r = annualRatePct / 1200   (e.g. 8.5% → 0.0070833…/month)
//   • per period:   interest = round(balance · r); principal = EMI − interest; balance −= principal
//   • a prepayment in a month is applied as EXTRA principal AFTER the regular component (same month)
//   • the final period is clamped to the exact remaining balance (+ that month's interest) — closure adj.
//
// This is a PLANNING estimate, NOT a bank statement. Real lenders often use DAILY reducing balance and
// their own rounding/value-date rules, so actual figures can differ by small amounts. Actual payments are
// recorded separately from reality (LoanPayment rows); this engine only projects.
//
// Money safety: all balances/components are held as INTEGER PAISE (1 rupee = 100 paise) so repeated
// subtraction never drifts; only the rate multiplication rounds (half-up via Math.round, mirroring how
// interest is rounded to paise). Inputs/outputs are rupees (numbers) with at most 2 decimals.

export type Prepayment = { monthIndex: number; amount: number }; // 1-based EMI number; extra principal (₹)
export type EmiOverride = { monthIndex: number; emi: number }; // 1-based month; the payment actually made that month (₹)

export type ScheduleRow = {
  index: number; // 1-based period number
  date: string | null; // ISO YYYY-MM-DD when startDate is given, else null
  emi: number; // actual payment scheduled this period (₹) — equals EMI except the final closure period
  interest: number; // interest component (₹)
  principal: number; // regular principal component (₹)
  prepayment: number; // extra principal applied this period (₹)
  balance: number; // remaining principal after this period (₹)
  cumInterest: number; // cumulative interest to date (₹)
  cumPrincipal: number; // cumulative principal (regular + prepay) to date (₹)
};

export type AmortResult = {
  rows: ScheduleRow[];
  totalInterest: number;
  totalPrincipal: number;
  totalPaid: number;
  months: number; // number of periods to closure
  closureDate: string | null;
};

export type AmortInput = {
  principal: number; // opening balance to amortize (₹) — original principal, or current outstanding
  annualRatePct: number; // annual interest rate, percent
  emi?: number; // fixed EMI (₹). If omitted, derived from tenureMonths via emiFor
  tenureMonths?: number; // used to derive EMI when emi is omitted
  startDate?: Date | string | null; // first period's date; period k is startDate + (k−1) months
  startIndex?: number; // label the first row with this index (default 1) — for mid-loan projections
  prepayments?: Prepayment[]; // extra principal by (labelled) month index
  emiOverrides?: EmiOverride[]; // per-month payment override (what-if: "this month I pay ₹X instead")
  maxMonths?: number; // cap the schedule at N periods and RETURN (don't throw) — for interest-only loans
                      // whose payment ≈ interest and so never fully amortize on their own.
};

const toPaise = (rupees: number) => Math.round(rupees * 100);
const toRupees = (paise: number) => paise / 100;
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Add k calendar months to a date, clamping the day so month-end dates never overflow (31 Jan + 1 → 28/29 Feb).
export function isoAddMonths(d: Date, k: number): string {
  const nd = new Date(d.getFullYear(), d.getMonth() + k, 1);
  const lastDay = new Date(nd.getFullYear(), nd.getMonth() + 1, 0).getDate();
  nd.setDate(Math.min(d.getDate(), lastDay));
  const mm = String(nd.getMonth() + 1).padStart(2, "0");
  const dd = String(nd.getDate()).padStart(2, "0");
  return `${nd.getFullYear()}-${mm}-${dd}`;
}

// The level EMI for a reducing-balance loan: P·r·(1+r)^n / ((1+r)^n − 1). r=0 → straight-line P/n.
export function emiFor(principal: number, annualRatePct: number, months: number): number {
  if (months <= 0 || principal <= 0) return 0;
  const r = annualRatePct / 1200;
  if (r === 0) return round2(principal / months);
  const f = Math.pow(1 + r, months);
  return round2((principal * r * f) / (f - 1));
}

// Split a single actual payment into interest + principal against a live balance (planning basis: this
// month's interest = balance · monthly rate). A prepayment is all principal. Principal is clamped so it
// never exceeds the outstanding. Used when a loan-linked Sheet bill is marked paid.
export function splitLoanPayment(outstanding: number, annualRatePct: number, amount: number, isPrepayment: boolean): { interest: number; principal: number } {
  const interest = isPrepayment ? 0 : round2(Math.max(0, outstanding) * (annualRatePct / 1200));
  let principal = round2(amount - interest);
  if (principal < 0) principal = 0;
  if (principal > outstanding) principal = round2(outstanding);
  return { interest, principal };
}

export function amortize(input: AmortInput): AmortResult {
  const rate = input.annualRatePct / 1200;
  const startIdx = input.startIndex ?? 1;
  const start = input.startDate ? new Date(input.startDate) : null;
  let balance = toPaise(input.principal);

  if (balance <= 0) {
    return { rows: [], totalInterest: 0, totalPrincipal: 0, totalPaid: 0, months: 0, closureDate: start ? isoAddMonths(start, 0) : null };
  }

  let emiPaise: number;
  if (input.emi != null && input.emi > 0) emiPaise = toPaise(input.emi);
  else if (input.tenureMonths && input.tenureMonths > 0) emiPaise = toPaise(emiFor(input.principal, input.annualRatePct, input.tenureMonths));
  else throw new Error("amortize: provide either emi or tenureMonths");

  // Prepayments keyed by the labelled month index (accumulate if several land on the same month).
  const prepayByIdx = new Map<number, number>();
  for (const p of input.prepayments ?? []) {
    if (p.amount > 0 && Number.isFinite(p.monthIndex)) {
      prepayByIdx.set(p.monthIndex, (prepayByIdx.get(p.monthIndex) ?? 0) + toPaise(p.amount));
    }
  }

  // Per-month payment overrides (what-if: "in month k I actually pay ₹X instead of the EMI").
  const overrideByIdx = new Map<number, number>();
  for (const o of input.emiOverrides ?? []) {
    if (o.emi >= 0 && Number.isFinite(o.monthIndex)) overrideByIdx.set(o.monthIndex, toPaise(o.emi));
  }

  // Horizon: an explicit maxMonths (interest-only display) caps and returns; otherwise a safety cap that,
  // if hit, means the EMI can't amortize → we throw below.
  const cap = input.maxMonths ?? Math.max(1200, (input.tenureMonths ?? 0) * 3 + 1200);

  const rows: ScheduleRow[] = [];
  let cumI = 0;
  let cumP = 0;
  let step = 0;

  while (balance > 0 && step < cap) {
    const label = startIdx + step;
    const interest = Math.round(balance * rate);
    // This month's payment: an override if the user set one, else the standard EMI.
    const override = overrideByIdx.get(label);
    let paymentPaise = override != null ? override : emiPaise;
    let principalComp = paymentPaise - interest;

    if (principalComp < 0) principalComp = 0; // payment < interest → no regular principal (balance won't fall)
    if (principalComp >= balance) {
      // Final regular period: pay exactly the remaining balance + this month's interest (closure adjustment).
      principalComp = balance;
      paymentPaise = interest + principalComp;
    }
    balance -= principalComp;

    let prepay = prepayByIdx.get(label) ?? 0;
    if (prepay > balance) prepay = balance; // never overpay past zero
    balance -= prepay;

    cumI += interest;
    cumP += principalComp + prepay;
    rows.push({
      index: label,
      date: start ? isoAddMonths(start, step) : null,
      emi: toRupees(paymentPaise),
      interest: toRupees(interest),
      principal: toRupees(principalComp),
      prepayment: toRupees(prepay),
      balance: toRupees(balance),
      cumInterest: toRupees(cumI),
      cumPrincipal: toRupees(cumP),
    });
    step++;
    if (balance <= 0) break;
  }

  // With an explicit maxMonths the caller WANTS a capped (possibly non-closing) schedule — return it.
  // Without one, a leftover balance means the EMI can't cover interest — a real error.
  if (balance > 0 && input.maxMonths == null) {
    throw new Error("amortize: loan does not close within the safety cap — the EMI is too low to cover interest");
  }

  return {
    rows,
    totalInterest: toRupees(cumI),
    totalPrincipal: toRupees(cumP),
    totalPaid: toRupees(cumI + cumP),
    months: rows.length,
    closureDate: rows.length ? rows[rows.length - 1].date : start ? isoAddMonths(start, 0) : null,
  };
}
