import { describe, it, expect } from "vitest";
import { projectLoan, isAmortizable, type LoanLike } from "./project";
import { emiFor } from "./amortize";

const base: LoanLike = {
  originalPrincipal: 4500000,
  outstanding: 4500000,
  interestRate: 8.5,
  originalTenureMonths: 108,
  emiAmount: emiFor(4500000, 8.5, 108),
  monthlyAmount: 0,
  startDate: "2026-01-01",
};

describe("isAmortizable", () => {
  it("true for a full loan master", () => expect(isAmortizable(base)).toBe(true));
  it("false without a rate (legacy manual tracker / chit)", () => {
    expect(isAmortizable({ ...base, interestRate: null })).toBe(false);
  });
  it("false without principal or emi/tenure", () => {
    expect(isAmortizable({ ...base, originalPrincipal: null, outstanding: 0 })).toBe(false);
    expect(isAmortizable({ ...base, emiAmount: 0, monthlyAmount: 0, originalTenureMonths: 0 })).toBe(false);
  });
});

describe("projectLoan", () => {
  it("returns null for a non-amortizable loan", () => {
    expect(projectLoan({ ...base, interestRate: null })).toBeNull();
  });

  it("fresh loan projects the full tenure and repays the whole principal", () => {
    const p = projectLoan({ ...base }, { asOf: new Date("2026-01-01") })!;
    expect(p.remainingMonths).toBeGreaterThanOrEqual(107);
    expect(p.remainingMonths).toBeLessThanOrEqual(108);
    expect(p.principalPaid).toBe(0);
    expect(p.schedule.at(-1)!.balance).toBe(0);
    expect(p.emi).toBe(base.emiAmount);
  });

  it("partly-paid loan projects fewer remaining months and shows principal paid", () => {
    const p = projectLoan({ ...base, outstanding: 3000000 }, { asOf: new Date("2028-01-01") })!;
    expect(p.principalPaid).toBe(1500000);
    expect(p.remainingMonths).toBeLessThan(108);
    expect(p.currentOutstanding).toBe(3000000);
    expect(p.schedule.at(-1)!.balance).toBe(0);
  });

  it("planned prepayments shorten the projection", () => {
    const asOf = new Date("2026-01-01");
    const noPre = projectLoan({ ...base }, { asOf })!;
    const withPre = projectLoan({ ...base }, { asOf, plannedPrepayments: [{ monthIndex: 6, amount: 500000 }] })!;
    expect(withPre.remainingMonths).toBeLessThan(noPre.remainingMonths);
    expect(withPre.totalInterestRemaining).toBeLessThan(noPre.totalInterestRemaining);
  });

  it("derives EMI from tenure when emiAmount/monthlyAmount are absent", () => {
    const p = projectLoan({ ...base, emiAmount: null, monthlyAmount: 0 }, { asOf: new Date("2026-01-01") })!;
    expect(p.emi).toBeGreaterThan(59000);
    expect(p.emi).toBeLessThan(61000);
  });
});
