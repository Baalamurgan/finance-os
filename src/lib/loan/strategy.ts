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

// ── Multi-loan payoff order (avalanche vs snowball) ───────────────────────────────────────────────
//
// Given several loans and a fixed EXTRA amount you can throw at debt each month, which loan do you
// attack first? Two classic orderings:
//   • avalanche — highest interest rate first (mathematically cheapest: least total interest).
//   • snowball  — smallest balance first (fastest first win: motivational).
// Both use the DEBT-ROLLOVER method: every loan keeps getting its own EMI; the extra pot (your spare
// amount + the EMIs freed as loans close) is piled onto the priority loan until it clears, then rolls
// to the next. Interest-only (gold/jewel) loans fold in naturally — their EMI ≈ interest so the
// balance only falls once the extra pot reaches them.

export type DebtLoan = {
  id: number;
  name: string;
  outstanding: number; // current balance (₹)
  annualRatePct: number;
  emi: number; // scheduled monthly payment (₹); may be ≈ interest for interest-only loans
};

export type DebtPlan = {
  orderIds: number[]; // attack order actually used
  orderNames: string[];
  totalInterest: number; // interest paid across all loans until everything clears (or the cap)
  months: number; // months until the last loan clears (= cap if it never clears)
  cleared: boolean; // did every loan reach zero within the horizon?
  closureDate: string | null;
  perLoan: { id: number; name: string; clearedMonth: number | null }[]; // 1-based month each loan cleared
  timeline: { monthIndex: number; date: string | null; balance: number }[]; // total balance after each month
};

const DEBT_CAP = 600; // 50-year horizon safety cap

// Simulate paying down a set of loans in a given priority order, with a fixed monthly extra and EMI
// rollover. Pure; integer-paise internally. `startDate` (default today) only labels the timeline.
export function simulateRollover(
  loans: DebtLoan[],
  orderIds: number[],
  extraMonthly: number,
  opts?: { rollover?: boolean; startDate?: Date; maxMonths?: number },
): DebtPlan {
  const rollover = opts?.rollover ?? true;
  const start = opts?.startDate ?? new Date();
  const cap = opts?.maxMonths ?? DEBT_CAP;

  const bal = new Map<number, number>(); // paise
  const emi = new Map<number, number>();
  const rate = new Map<number, number>();
  const clearedMonth = new Map<number, number>();
  for (const l of loans) {
    bal.set(l.id, Math.max(0, Math.round(l.outstanding * 100)));
    emi.set(l.id, Math.max(0, Math.round(l.emi * 100)));
    rate.set(l.id, l.annualRatePct / 1200);
  }
  // Only loans that appear in orderIds receive the extra pot; any omitted loans still pay their EMI.
  const order = orderIds.filter((id) => bal.has(id));
  const extraPaise = Math.max(0, Math.round(extraMonthly * 100));

  let totalInterest = 0;
  const timeline: DebtPlan["timeline"] = [];
  let month = 0;
  const outstandingTotal = () => [...bal.values()].reduce((s, b) => s + b, 0);

  while (outstandingTotal() > 0 && month < cap) {
    month++;
    // 1. Every open loan accrues interest and pays its own EMI.
    for (const l of loans) {
      let b = bal.get(l.id)!;
      if (b <= 0) continue;
      const r = rate.get(l.id)!;
      const interest = Math.round(b * r);
      let principal = emi.get(l.id)! - interest;
      if (principal < 0) principal = 0; // EMI ≤ interest → balance flat (interest-only)
      if (principal > b) principal = b;
      b -= principal;
      totalInterest += interest;
      bal.set(l.id, b);
    }
    // 2. Build the extra pot: your spare cash + the EMIs of loans that have already closed (rollover).
    let pot = extraPaise;
    if (rollover) {
      for (const l of loans) {
        const cm = clearedMonth.get(l.id);
        if (cm != null && cm < month) pot += emi.get(l.id)!;
      }
    }
    // 3. Pour the pot onto the priority loans, in order.
    for (const id of order) {
      if (pot <= 0) break;
      const b = bal.get(id)!;
      if (b <= 0) continue;
      const applied = Math.min(pot, b);
      bal.set(id, b - applied);
      pot -= applied;
    }
    // 4. Record any closures this month.
    for (const l of loans) {
      if (bal.get(l.id)! <= 0 && !clearedMonth.has(l.id)) clearedMonth.set(l.id, month);
    }
    timeline.push({ monthIndex: month, date: isoAddMonths(start, month), balance: outstandingTotal() / 100 });
  }

  const cleared = outstandingTotal() <= 0;
  return {
    orderIds: order,
    orderNames: order.map((id) => loans.find((l) => l.id === id)?.name ?? String(id)),
    totalInterest: round2(totalInterest / 100),
    months: month,
    cleared,
    closureDate: cleared ? isoAddMonths(start, month) : null,
    perLoan: loans.map((l) => ({ id: l.id, name: l.name, clearedMonth: clearedMonth.get(l.id) ?? null })),
    timeline,
  };
}

// Rank loans for the two classic strategies.
export function avalancheOrder(loans: DebtLoan[]): number[] {
  return [...loans].filter((l) => l.outstanding > 0).sort((a, b) => b.annualRatePct - a.annualRatePct || a.outstanding - b.outstanding).map((l) => l.id);
}
export function snowballOrder(loans: DebtLoan[]): number[] {
  return [...loans].filter((l) => l.outstanding > 0).sort((a, b) => a.outstanding - b.outstanding || b.annualRatePct - a.annualRatePct).map((l) => l.id);
}

export type DebtComparison = {
  extraMonthly: number;
  baseline: DebtPlan; // EMIs only — no extra, no rollover
  avalanche: DebtPlan;
  snowball: DebtPlan;
  recommended: "avalanche" | "snowball";
  interestSavedVsBaseline: number | null; // recommended vs baseline (null if baseline never clears)
  monthsSavedVsBaseline: number | null;
};

// Compare avalanche vs snowball for a given extra/month, both against the EMIs-only baseline.
export function compareDebtStrategies(loans: DebtLoan[], extraMonthly: number, opts?: { startDate?: Date }): DebtComparison {
  const startDate = opts?.startDate;
  const baseline = simulateRollover(loans, [], 0, { rollover: false, startDate });
  const avalanche = simulateRollover(loans, avalancheOrder(loans), extraMonthly, { rollover: true, startDate });
  const snowball = simulateRollover(loans, snowballOrder(loans), extraMonthly, { rollover: true, startDate });
  // Avalanche is never worse on interest; ties (or a snowball that clears sooner) still favour avalanche
  // as the cheaper default, but surface snowball when it strictly costs less (can happen with rounding).
  const recommended: "avalanche" | "snowball" = snowball.totalInterest < avalanche.totalInterest ? "snowball" : "avalanche";
  const best = recommended === "avalanche" ? avalanche : snowball;
  const interestSavedVsBaseline = baseline.cleared ? round2(baseline.totalInterest - best.totalInterest) : null;
  const monthsSavedVsBaseline = baseline.cleared ? baseline.months - best.months : null;
  return { extraMonthly, baseline, avalanche, snowball, recommended, interestSavedVsBaseline, monthsSavedVsBaseline };
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
