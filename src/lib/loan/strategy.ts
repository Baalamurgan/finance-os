// ── Loan payoff-strategy engine ──────────────────────────────────────────────────────────────────────
//
// Built on the amortization engine. Turns high-level repayment strategies into concrete prepayment
// schedules, projects them, and compares them against the EMI-only baseline (interest saved, months
// saved). All figures are PLANNING estimates (see amortize.ts). Pure + independently testable.
//
// Two strategies for extra principal:
//   • reduce_tenure — keep the EMI, prepayments shorten the term (the user's preferred strategy).
//   • reduce_emi    — keep the original closure horizon, prepayments lower future EMIs instead.

import { amortize, emiFor, isoAddMonths, round2, type AmortResult, type AmortInput, type Prepayment } from "./amortize";

export type Strategy = "reduce_tenure" | "reduce_emi";

// A recurring extra-principal plan, e.g. ₹50k every month, ₹1L every quarter, ₹2L once a year.
export type RecurringSpec = {
  amount: number; // extra principal per occurrence (₹)
  everyMonths: number; // 1 = monthly, 3 = quarterly, 12 = annual
  startMonth?: number; // first month index it applies (1-based, default = everyMonths)
  count?: number; // number of occurrences (default = fill the horizon)
};

// Expand a recurring spec into concrete Prepayment rows across a horizon.
export function buildRecurringPrepayments(spec: RecurringSpec, horizonMonths: number): Prepayment[] {
  const out: Prepayment[] = [];
  if (spec.amount <= 0 || spec.everyMonths <= 0) return out;
  const start = spec.startMonth ?? spec.everyMonths;
  let n = 0;
  for (let m = start; m <= horizonMonths; m += spec.everyMonths) {
    if (spec.count != null && n >= spec.count) break;
    out.push({ monthIndex: m, amount: spec.amount });
    n++;
  }
  return out;
}

export type ProjectInput = AmortInput & { strategy?: Strategy };

// Project a repayment plan. reduce_tenure defers to amortize; reduce_emi keeps the original closure
// horizon and steps the EMI down after each prepayment.
export function project(input: ProjectInput): AmortResult {
  if ((input.strategy ?? "reduce_tenure") === "reduce_tenure") {
    return amortize(input);
  }
  // reduce_emi needs an anchor tenure to recompute EMIs against.
  const tenure = input.tenureMonths;
  if (!tenure || tenure <= 0) throw new Error("project(reduce_emi): tenureMonths is required as the closure anchor");
  return amortizeReduceEmi(input, tenure);
}

// reduce_emi loop: after a prepayment, reset the EMI to clear the remaining balance over the remaining
// original tenure — so the closure date stays ~fixed and the monthly outgo drops instead.
function amortizeReduceEmi(input: ProjectInput, tenure: number): AmortResult {
  const rate = input.annualRatePct / 1200;
  const startIdx = input.startIndex ?? 1;
  const start = input.startDate ? new Date(input.startDate) : null;
  let balance = Math.round(input.principal * 100); // paise
  if (balance <= 0) return { rows: [], totalInterest: 0, totalPrincipal: 0, totalPaid: 0, months: 0, closureDate: start ? isoAddMonths(start, 0) : null };

  let emiPaise = Math.round((input.emi && input.emi > 0 ? input.emi : emiFor(input.principal, input.annualRatePct, tenure)) * 100);
  const prepayByIdx = new Map<number, number>();
  for (const p of input.prepayments ?? []) if (p.amount > 0) prepayByIdx.set(p.monthIndex, (prepayByIdx.get(p.monthIndex) ?? 0) + Math.round(p.amount * 100));

  const cap = Math.max(1200, tenure * 3 + 1200);
  const rows = [];
  let cumI = 0, cumP = 0, step = 0;
  while (balance > 0 && step < cap) {
    const label = startIdx + step;
    const interest = Math.round(balance * rate);
    let principalComp = emiPaise - interest;
    let paymentPaise = emiPaise;
    if (principalComp < 0) principalComp = 0;
    if (principalComp >= balance) { principalComp = balance; paymentPaise = interest + principalComp; }
    balance -= principalComp;
    let prepay = prepayByIdx.get(label) ?? 0;
    if (prepay > balance) prepay = balance;
    balance -= prepay;
    cumI += interest; cumP += principalComp + prepay;
    rows.push({
      index: label, date: start ? isoAddMonths(start, step) : null,
      emi: paymentPaise / 100, interest: interest / 100, principal: principalComp / 100,
      prepayment: prepay / 100, balance: balance / 100, cumInterest: cumI / 100, cumPrincipal: cumP / 100,
    });
    step++;
    // after a prepayment, re-level the EMI over the remaining original tenure
    if (prepay > 0 && balance > 0) {
      const remaining = tenure - step;
      if (remaining > 0) emiPaise = Math.round(emiFor(balance / 100, input.annualRatePct, remaining) * 100);
    }
    if (balance <= 0) break;
  }
  if (balance > 0) throw new Error("project(reduce_emi): does not close within the safety cap");
  return { rows, totalInterest: cumI / 100, totalPrincipal: cumP / 100, totalPaid: (cumI + cumP) / 100, months: rows.length, closureDate: rows.length ? rows[rows.length - 1].date : null };
}

export type Summary = {
  emi: number; // the (initial) EMI used
  totalPrincipal: number;
  totalInterest: number;
  totalPaid: number;
  months: number;
  closureDate: string | null;
};

export function summarize(result: AmortResult, emi: number): Summary {
  return {
    emi: round2(emi),
    totalPrincipal: result.totalPrincipal,
    totalInterest: result.totalInterest,
    totalPaid: result.totalPaid,
    months: result.months,
    closureDate: result.closureDate,
  };
}

// Interest and months saved of a scenario vs a baseline projection.
export function savingsVs(base: AmortResult, scenario: AmortResult): { interestSaved: number; monthsSaved: number } {
  return {
    interestSaved: round2(base.totalInterest - scenario.totalInterest),
    monthsSaved: base.months - scenario.months,
  };
}

export type NamedScenario = { name: string; prepayments?: Prepayment[]; recurring?: RecurringSpec; strategy?: Strategy };
export type ScenarioResult = Summary & { name: string; interestSaved: number; monthsSaved: number };

// Compare scenarios side by side against the EMI-only baseline (first scenario is not assumed to be base;
// the baseline is computed with no prepayments and the caller's strategy default = reduce_tenure).
export function compareScenarios(base: AmortInput, scenarios: NamedScenario[]): ScenarioResult[] {
  const emi = base.emi && base.emi > 0 ? base.emi : emiFor(base.principal, base.annualRatePct, base.tenureMonths ?? 0);
  const baseline = amortize({ ...base, emi });
  const horizon = base.tenureMonths ?? baseline.months;
  return scenarios.map((s) => {
    const prepayments = s.prepayments ?? (s.recurring ? buildRecurringPrepayments(s.recurring, horizon) : []);
    const res = project({ ...base, emi, prepayments, strategy: s.strategy });
    const { interestSaved, monthsSaved } = savingsVs(baseline, res);
    return { name: s.name, ...summarize(res, emi), interestSaved, monthsSaved };
  });
}
