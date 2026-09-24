import { describe, it, expect } from "vitest";
import { emiFor, amortize, round2 } from "./amortize";
import { buildRecurringPrepayments, project, savingsVs, compareScenarios } from "./strategy";

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
