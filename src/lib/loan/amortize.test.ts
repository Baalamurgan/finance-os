import { describe, it, expect } from "vitest";
import { emiFor, amortize, isoAddMonths, round2, splitLoanPayment, type AmortResult } from "./amortize";

// Sum helper tolerant of paise rounding.
const near = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps;

describe("emiFor", () => {
  it("zero-rate loan is straight-line principal / months", () => {
    expect(emiFor(120000, 0, 12)).toBe(10000);
  });
  it("matches the standard textbook EMI (₹1,00,000 @ 12% for 12m = ₹8,884.88)", () => {
    expect(emiFor(100000, 12, 12)).toBe(8884.88);
  });
  it("handles a large home loan (₹45,00,000 @ 8.5% for 108m)", () => {
    const emi = emiFor(4500000, 8.5, 108);
    expect(emi).toBeGreaterThan(59000);
    expect(emi).toBeLessThan(61000); // ~₹59,755
  });
  it("guards degenerate inputs", () => {
    expect(emiFor(0, 10, 12)).toBe(0);
    expect(emiFor(100000, 10, 0)).toBe(0);
  });
});

describe("amortize — core schedule", () => {
  const r = amortize({ principal: 100000, annualRatePct: 12, emi: emiFor(100000, 12, 12), tenureMonths: 12 });

  it("closes in the scheduled number of months with a zero final balance", () => {
    expect(r.months).toBe(12);
    expect(r.rows.length).toBe(12);
    expect(r.rows[r.rows.length - 1].balance).toBe(0);
  });
  it("repays exactly the original principal", () => {
    expect(round2(r.totalPrincipal)).toBe(100000);
    expect(near(r.rows.reduce((s, x) => s + x.principal + x.prepayment, 0), 100000)).toBe(true);
  });
  it("keeps balance monotonically decreasing", () => {
    for (let i = 1; i < r.rows.length; i++) expect(r.rows[i].balance).toBeLessThan(r.rows[i - 1].balance);
  });
  it("each period's principal+interest equals the EMI (except the closure period)", () => {
    for (const row of r.rows.slice(0, -1)) expect(near(row.principal + row.interest, row.emi)).toBe(true);
  });
  it("cumulative totals reconcile", () => {
    expect(near(r.totalInterest, r.rows.reduce((s, x) => s + x.interest, 0))).toBe(true);
    expect(near(r.totalPaid, r.totalInterest + r.totalPrincipal)).toBe(true);
    expect(r.rows[r.rows.length - 1].cumPrincipal).toBe(r.totalPrincipal);
  });
});

describe("amortize — zero rate", () => {
  it("has no interest and closes cleanly", () => {
    const r = amortize({ principal: 120000, annualRatePct: 0, emi: 10000 });
    expect(r.months).toBe(12);
    expect(r.totalInterest).toBe(0);
    expect(r.rows.at(-1)!.balance).toBe(0);
  });
});

describe("amortize — EMI derived from tenure", () => {
  it("works without an explicit emi", () => {
    const r = amortize({ principal: 100000, annualRatePct: 12, tenureMonths: 12 });
    expect(r.months).toBe(12);
    expect(r.rows.at(-1)!.balance).toBe(0);
  });
});

describe("amortize — prepayments (reduce tenure)", () => {
  const base = amortize({ principal: 4500000, annualRatePct: 8.5, emi: emiFor(4500000, 8.5, 108) });

  it("a single prepayment shortens tenure and cuts total interest", () => {
    const withPre = amortize({
      principal: 4500000,
      annualRatePct: 8.5,
      emi: emiFor(4500000, 8.5, 108),
      prepayments: [{ monthIndex: 3, amount: 200000 }],
    });
    expect(withPre.months).toBeLessThan(base.months);
    expect(withPre.totalInterest).toBeLessThan(base.totalInterest);
    expect(round2(withPre.totalPrincipal)).toBe(4500000); // principal repaid is unchanged
  });

  it("multiple prepayments compound the saving; still repays exactly the principal", () => {
    const r = amortize({
      principal: 4500000,
      annualRatePct: 8.5,
      emi: emiFor(4500000, 8.5, 108),
      prepayments: [
        { monthIndex: 3, amount: 50000 },
        { monthIndex: 6, amount: 100000 },
        { monthIndex: 12, amount: 200000 },
      ],
    });
    expect(r.months).toBeLessThan(base.months);
    expect(round2(r.totalPrincipal)).toBe(4500000);
    expect(r.rows.at(-1)!.balance).toBe(0);
  });

  it("EMI + prepayment in the same month both apply that period", () => {
    const r = amortize({ principal: 100000, annualRatePct: 12, emi: emiFor(100000, 12, 12), prepayments: [{ monthIndex: 2, amount: 20000 }] });
    expect(r.rows[1].prepayment).toBe(20000);
    expect(r.rows[1].principal).toBeGreaterThan(0);
    expect(r.months).toBeLessThan(12);
  });

  it("a prepayment larger than the balance is capped (never goes negative)", () => {
    const r = amortize({ principal: 100000, annualRatePct: 12, emi: emiFor(100000, 12, 12), prepayments: [{ monthIndex: 2, amount: 999999 }] });
    expect(r.months).toBe(2);
    expect(r.rows.at(-1)!.balance).toBe(0);
    expect(round2(r.totalPrincipal)).toBe(100000);
  });
});

describe("amortize — per-month EMI overrides (what-if)", () => {
  const emi = emiFor(800000, 8.5, 0 || 14); // ~₹8L over ~14 months for a quick example
  const base = amortize({ principal: 800000, annualRatePct: 8.5, emi });

  it("paying MORE in a month shortens the tenure and cuts interest", () => {
    const r = amortize({ principal: 800000, annualRatePct: 8.5, emi, emiOverrides: [{ monthIndex: 2, emi: emi + 100000 }] });
    expect(r.rows[1].emi).toBe(emi + 100000);
    expect(r.months).toBeLessThan(base.months);
    expect(r.totalInterest).toBeLessThan(base.totalInterest);
    expect(round2(r.totalPrincipal)).toBe(800000);
  });

  it("paying LESS in a month lengthens the tenure and adds interest", () => {
    const r = amortize({ principal: 800000, annualRatePct: 8.5, emi, emiOverrides: [{ monthIndex: 2, emi: 20000 }] });
    expect(r.rows[1].emi).toBe(20000);
    expect(r.months).toBeGreaterThanOrEqual(base.months);
    expect(r.totalInterest).toBeGreaterThan(base.totalInterest);
    expect(round2(r.totalPrincipal)).toBe(800000);
  });

  it("an override never overshoots — the loan still closes at exactly zero", () => {
    const r = amortize({ principal: 800000, annualRatePct: 8.5, emi, emiOverrides: [{ monthIndex: 1, emi: 5000000 }] });
    expect(r.months).toBe(1);
    expect(r.rows.at(-1)!.balance).toBe(0);
    expect(round2(r.totalPrincipal)).toBe(800000);
  });
});

describe("splitLoanPayment (mark-a-bill-paid split)", () => {
  it("EMI splits into interest (balance·rate) + principal", () => {
    // ₹8L @ 8.5% → monthly interest = 800000·0.085/12 = 5666.67
    const s = splitLoanPayment(800000, 8.5, 61750, false);
    expect(s.interest).toBe(5666.67);
    expect(s.principal).toBe(round2(61750 - 5666.67));
  });
  it("a prepayment is all principal (no interest)", () => {
    const s = splitLoanPayment(800000, 8.5, 270000, true);
    expect(s.interest).toBe(0);
    expect(s.principal).toBe(270000);
  });
  it("principal never exceeds the outstanding (final payment)", () => {
    const s = splitLoanPayment(5000, 8.5, 61750, false);
    expect(s.principal).toBe(5000);
  });
  it("a payment smaller than the interest yields zero principal", () => {
    const s = splitLoanPayment(800000, 8.5, 1000, false);
    expect(s.principal).toBe(0);
  });
});

describe("amortize — dates", () => {
  it("increments monthly from startDate and clamps month-end overflow", () => {
    const r = amortize({ principal: 100000, annualRatePct: 12, emi: emiFor(100000, 12, 12), startDate: "2026-01-31" });
    expect(r.rows[0].date).toBe("2026-01-31");
    expect(r.rows[1].date).toBe("2026-02-28"); // clamped, not 31 Feb
    expect(r.rows[2].date).toBe("2026-03-31");
    expect(r.closureDate).toBe(r.rows.at(-1)!.date);
  });
  it("startIndex offsets the row labels (mid-loan projection)", () => {
    const r = amortize({ principal: 50000, annualRatePct: 10, emi: emiFor(50000, 10, 6), startIndex: 25 });
    expect(r.rows[0].index).toBe(25);
  });
  it("isoAddMonths clamps correctly", () => {
    expect(isoAddMonths(new Date(2026, 0, 31), 1)).toBe("2026-02-28");
  });
});

describe("amortize — maxMonths horizon (interest-only)", () => {
  it("caps and returns (no throw) when the payment can't amortize", () => {
    const r = amortize({ principal: 1000000, annualRatePct: 9, emi: 5000, maxMonths: 60 }); // EMI < interest
    expect(r.rows.length).toBe(60);
    expect(r.rows.at(-1)!.balance).toBeGreaterThan(0); // never closes — flat balance
    expect(r.rows[0].principal).toBe(0); // whole payment is interest
  });
  it("still closes early within the cap when it can amortize", () => {
    const r = amortize({ principal: 100000, annualRatePct: 12, emi: emiFor(100000, 12, 12), maxMonths: 60 });
    expect(r.months).toBe(12);
    expect(r.rows.at(-1)!.balance).toBe(0);
  });
});

describe("amortize — guards", () => {
  it("throws when the EMI can never cover interest (unpayable)", () => {
    expect(() => amortize({ principal: 4500000, annualRatePct: 8.5, emi: 100 })).toThrow();
  });
  it("throws when neither emi nor tenure is provided", () => {
    expect(() => amortize({ principal: 100000, annualRatePct: 10 })).toThrow();
  });
  it("returns an empty schedule for a zero principal", () => {
    const r = amortize({ principal: 0, annualRatePct: 10, emi: 5000 });
    expect(r.months).toBe(0);
    expect(r.rows).toEqual([]);
  });
});

describe("amortize — large-loan sanity", () => {
  it("₹45,00,000 @ 8.5% closes at ~108 months with total interest in a sane band", () => {
    const emi = emiFor(4500000, 8.5, 108);
    const r: AmortResult = amortize({ principal: 4500000, annualRatePct: 8.5, emi, tenureMonths: 108 });
    expect(r.months).toBeGreaterThanOrEqual(107);
    expect(r.months).toBeLessThanOrEqual(108);
    expect(r.rows.at(-1)!.balance).toBe(0);
    expect(r.totalInterest).toBeGreaterThan(1800000); // ~₹19–20L interest over the term
    expect(r.totalInterest).toBeLessThan(2100000);
  });
});
