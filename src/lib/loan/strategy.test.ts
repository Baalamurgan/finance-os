import { describe, it, expect } from "vitest";
import { emiFor, amortize, round2 } from "./amortize";
import { buildRecurringPrepayments, project, savingsVs, compareScenarios, simulateRollover, avalancheOrder, snowballOrder, compareDebtStrategies, type DebtLoan } from "./strategy";

const P = 4500000;
const RATE = 8.5;
const N = 108;
const EMI = emiFor(P, RATE, N);

describe("buildRecurringPrepayments", () => {
  it("monthly plan fills the horizon", () => {
    const pre = buildRecurringPrepayments({ amount: 50000, everyMonths: 1 }, 12);
    expect(pre.length).toBe(12);
    expect(pre[0]).toEqual({ monthIndex: 1, amount: 50000 });
  });
  it("quarterly plan lands every 3 months", () => {
    const pre = buildRecurringPrepayments({ amount: 100000, everyMonths: 3 }, 12);
    expect(pre.map((p) => p.monthIndex)).toEqual([3, 6, 9, 12]);
  });
  it("annual plan respects count", () => {
    const pre = buildRecurringPrepayments({ amount: 200000, everyMonths: 12, count: 2 }, 108);
    expect(pre.map((p) => p.monthIndex)).toEqual([12, 24]);
  });
  it("ignores non-positive amounts", () => {
    expect(buildRecurringPrepayments({ amount: 0, everyMonths: 1 }, 12)).toEqual([]);
  });
});

describe("project — reduce_tenure", () => {
  it("matches amortize with the same prepayments", () => {
    const pre = [{ monthIndex: 6, amount: 100000 }];
    const a = amortize({ principal: P, annualRatePct: RATE, emi: EMI, prepayments: pre });
    const b = project({ principal: P, annualRatePct: RATE, emi: EMI, prepayments: pre, strategy: "reduce_tenure" });
    expect(b.months).toBe(a.months);
    expect(b.totalInterest).toBe(a.totalInterest);
  });
});

describe("project — reduce_emi", () => {
  it("keeps the closure horizon ~fixed and lowers the EMI after a prepayment", () => {
    const r = project({
      principal: P, annualRatePct: RATE, emi: EMI, tenureMonths: N,
      prepayments: [{ monthIndex: 12, amount: 500000 }], strategy: "reduce_emi",
    });
    // closes on/around the original tenure (not dramatically earlier); rounding of the re-levelled EMI
    // can push it a month past N.
    expect(r.months).toBeGreaterThanOrEqual(N - 1);
    expect(r.months).toBeLessThanOrEqual(N + 2);
    // EMI after the month-12 prepayment is lower than before it
    const before = r.rows[10].emi; // month 11
    const after = r.rows[12].emi; // month 13 (post-prepay re-level)
    expect(after).toBeLessThan(before);
    expect(round2(r.totalPrincipal)).toBe(P);
  });
  it("requires a tenure anchor", () => {
    expect(() => project({ principal: P, annualRatePct: RATE, emi: EMI, strategy: "reduce_emi" })).toThrow();
  });
});

describe("reduce_tenure vs reduce_emi — the classic trade-off", () => {
  it("tenure-reduction saves more interest; EMI-reduction eases cash-flow but keeps the term", () => {
    const pre = [{ monthIndex: 12, amount: 500000 }];
    const tenure = project({ principal: P, annualRatePct: RATE, emi: EMI, tenureMonths: N, prepayments: pre, strategy: "reduce_tenure" });
    const emiCut = project({ principal: P, annualRatePct: RATE, emi: EMI, tenureMonths: N, prepayments: pre, strategy: "reduce_emi" });
    expect(tenure.totalInterest).toBeLessThan(emiCut.totalInterest); // keeping EMI high saves more interest
    expect(tenure.months).toBeLessThan(emiCut.months); // and finishes sooner
  });
});

describe("savingsVs", () => {
  it("computes interest and months saved", () => {
    const base = amortize({ principal: P, annualRatePct: RATE, emi: EMI });
    const scen = amortize({ principal: P, annualRatePct: RATE, emi: EMI, prepayments: [{ monthIndex: 3, amount: 300000 }] });
    const s = savingsVs(base, scen);
    expect(s.interestSaved).toBeGreaterThan(0);
    expect(s.monthsSaved).toBeGreaterThan(0);
  });
});

describe("compareScenarios", () => {
  const results = compareScenarios(
    { principal: P, annualRatePct: RATE, emi: EMI, tenureMonths: N },
    [
      { name: "EMI only" },
      { name: "₹50k / month", recurring: { amount: 50000, everyMonths: 1 } },
      { name: "₹1L / quarter", recurring: { amount: 100000, everyMonths: 3 } },
      { name: "₹2L / year", recurring: { amount: 200000, everyMonths: 12 } },
    ],
  );

  it("EMI-only baseline saves nothing", () => {
    const base = results[0];
    expect(base.interestSaved).toBe(0);
    expect(base.monthsSaved).toBe(0);
  });
  it("every extra-payment scenario saves interest and months", () => {
    for (const r of results.slice(1)) {
      expect(r.interestSaved).toBeGreaterThan(0);
      expect(r.monthsSaved).toBeGreaterThan(0);
    }
  });
  it("more aggressive prepayment saves more (monthly ≥ quarterly ≥ annual)", () => {
    const [, monthly, quarterly, annual] = results;
    expect(monthly.interestSaved).toBeGreaterThan(quarterly.interestSaved);
    expect(quarterly.interestSaved).toBeGreaterThan(annual.interestSaved);
  });
});

// ── Multi-loan payoff order (avalanche vs snowball) ──────────────────────────────────────────────
// A realistic joint-family mix: a big cheap home loan + two small dear jewel (interest-only) loans.
const HOME: DebtLoan = { id: 1, name: "Home loan", outstanding: 800000, annualRatePct: 8.5, emi: emiFor(800000, 8.5, 120) };
const JL1: DebtLoan = { id: 2, name: "Jewel 1", outstanding: 700000, annualRatePct: 12.79, emi: round2(700000 * 12.79 / 1200) }; // EMI ≈ interest
const JL2: DebtLoan = { id: 3, name: "Jewel 2", outstanding: 1000000, annualRatePct: 9.15, emi: round2(1000000 * 9.15 / 1200) };
const LOANS = [HOME, JL1, JL2];

describe("avalanche / snowball ordering", () => {
  it("avalanche attacks the highest rate first", () => {
    expect(avalancheOrder(LOANS)).toEqual([2, 3, 1]); // 12.79% → 9.15% → 8.5%
  });
  it("snowball attacks the smallest balance first", () => {
    expect(snowballOrder(LOANS)).toEqual([2, 1, 3]); // 7L → 8L → 10L
  });
  it("drops already-cleared loans", () => {
    expect(avalancheOrder([...LOANS, { id: 9, name: "Paid off", outstanding: 0, annualRatePct: 20, emi: 0 }])).not.toContain(9);
  });
});

describe("simulateRollover", () => {
  it("interest-only loans never clear on EMIs alone (baseline hits the cap)", () => {
    const base = simulateRollover([JL1], [], 0, { rollover: false, maxMonths: 120 });
    expect(base.cleared).toBe(false);
    expect(base.months).toBe(120);
    expect(base.perLoan[0].clearedMonth).toBeNull();
  });
  it("an extra pot clears the priority loan, then rolls its EMI to the next", () => {
    const plan = simulateRollover(LOANS, avalancheOrder(LOANS), 30000, { rollover: true });
    expect(plan.cleared).toBe(true);
    const [jl1, jl2, home] = [plan.perLoan.find((p) => p.id === 2)!, plan.perLoan.find((p) => p.id === 3)!, plan.perLoan.find((p) => p.id === 1)!];
    // Avalanche order 2 → 3 → 1, so they clear in that sequence.
    expect(jl1.clearedMonth).toBeLessThan(jl2.clearedMonth!);
    expect(jl2.clearedMonth).toBeLessThanOrEqual(home.clearedMonth!);
  });
  it("the total-balance timeline is monotonically non-increasing and ends at zero", () => {
    const plan = simulateRollover(LOANS, avalancheOrder(LOANS), 30000);
    for (let i = 1; i < plan.timeline.length; i++) expect(plan.timeline[i].balance).toBeLessThanOrEqual(plan.timeline[i - 1].balance + 0.01);
    expect(plan.timeline.at(-1)!.balance).toBe(0);
  });
});

describe("compareDebtStrategies", () => {
  const cmp = compareDebtStrategies(LOANS, 30000);
  it("avalanche is never more expensive than snowball on total interest", () => {
    expect(cmp.avalanche.totalInterest).toBeLessThanOrEqual(cmp.snowball.totalInterest + 0.01);
  });
  it("recommends avalanche for this mix", () => {
    expect(cmp.recommended).toBe("avalanche");
  });
  it("both strategies clear the debt with the extra pot", () => {
    expect(cmp.avalanche.cleared).toBe(true);
    expect(cmp.snowball.cleared).toBe(true);
  });
  it("baseline never clears (interest-only loans), so savings-vs-baseline is not computed", () => {
    expect(cmp.baseline.cleared).toBe(false);
    expect(cmp.interestSavedVsBaseline).toBeNull();
  });
  it("an all-amortizing set does clear at baseline and yields positive interest saved", () => {
    const amortizing = [HOME, { id: 5, name: "Car", outstanding: 300000, annualRatePct: 10, emi: emiFor(300000, 10, 48) }];
    const c = compareDebtStrategies(amortizing, 20000);
    expect(c.baseline.cleared).toBe(true);
    expect(c.interestSavedVsBaseline).toBeGreaterThan(0);
    expect(c.monthsSavedVsBaseline).toBeGreaterThan(0);
  });
});
