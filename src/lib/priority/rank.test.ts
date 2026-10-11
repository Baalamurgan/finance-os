import { describe, it, expect } from "vitest";
import { rankPayables, type Payable } from "@/lib/priority/rank";

// Small builders so each test reads as the scenario, not the plumbing.
const loanInterest = (id: string, outstanding: number, rate: number): Payable => ({
  id,
  label: id,
  kind: "loan_interest",
  amount: outstanding,
  divisible: true,
  mandatoryDefault: false,
  annualRatePct: rate,
});
const emi = (id: string, amount: number, monthlyCost: number): Payable => ({
  id,
  label: id,
  kind: "loan_emi",
  amount,
  divisible: false,
  mandatoryDefault: true,
  monthlyCost,
});
const bill = (id: string, amount: number): Payable => ({
  id,
  label: id,
  kind: "bill",
  amount,
  divisible: false,
  mandatoryDefault: true,
});
const taxDue = (id: string, amount: number, monthlyCost: number): Payable => ({
  id,
  label: id,
  kind: "tax_due",
  amount,
  divisible: false,
  mandatoryDefault: false,
  monthlyCost,
});

describe("rankPayables — cost of waiting", () => {
  it("avalanche: higher-rate deferrable loan is filled first (efficiency sort)", () => {
    const r = rankPayables({
      payables: [loanInterest("J18", 100000, 18), loanInterest("J24", 50000, 24)],
      balance: 60000,
      sortBy: "efficiency",
    });
    // 24% (eff 2.0) outranks 18% (eff 1.5) regardless of input order.
    expect(r.deferrable.map((d) => d.id)).toEqual(["J24", "J18"]);
    expect(r.deferrable[0].allocated).toBe(50000); // J24 filled in full
    expect(r.deferrable[0].verdict).toBe("pay");
    expect(r.deferrable[1].allocated).toBe(10000); // J18 gets the remaining 10k
    expect(r.deferrable[1].verdict).toBe("partial");
    expect(r.leftover).toBe(0);
  });

  it("divisible loan: partial fill, deferred cost is interest on the unpaid principal", () => {
    const r = rankPayables({ payables: [loanInterest("JL", 100000, 18)], balance: 30000, sortBy: "efficiency" });
    const d = r.deferrable[0];
    expect(d.costOfWaiting).toBe(1500); // 100000 × 18 / 1200
    expect(d.efficiency).toBe(1.5); // rate / 12
    expect(d.allocated).toBe(30000);
    expect(d.verdict).toBe("partial");
    expect(d.deferredCost).toBe(1050); // interest on the unpaid 70k = 1500 × 0.7
    expect(r.penaltyAvoided).toBe(450); // 1500 − 1050
    expect(r.penaltyIncurred).toBe(1050);
  });

  it("indivisible knapsack: skip the big item that won't fit, pay the smaller one that does", () => {
    const r = rankPayables({
      payables: [taxDue("BIG", 25000, 250), taxDue("SMALL", 5000, 50)],
      balance: 10000,
      sortBy: "cost",
    });
    const big = r.deferrable.find((d) => d.id === "BIG")!;
    const small = r.deferrable.find((d) => d.id === "SMALL")!;
    expect(r.deferrable[0].id).toBe("BIG"); // cost sort ranks BIG first…
    expect(big.allocated).toBe(0); // …but it can't fit, so it's skipped
    expect(big.verdict).toBe("defer");
    expect(small.allocated).toBe(5000); // the smaller one still fits
    expect(small.verdict).toBe("pay");
    expect(r.leftover).toBe(5000);
  });

  it("mandatory is paid first in listed order and is NOT re-sorted by cost", () => {
    const r = rankPayables({
      payables: [bill("rent", 16000), emi("emi", 20000, 3375)],
      balance: 40000,
      sortBy: "cost",
    });
    expect(r.mandatory.map((m) => m.id)).toEqual(["rent", "emi"]); // listed order, even though emi has the higher cost
    expect(r.mandatory.every((m) => m.verdict === "pay")).toBe(true);
    expect(r.mandatoryTotal).toBe(36000);
    expect(r.leftover).toBe(4000);
    expect(r.shortfall).toBe(0);
  });

  it("shortfall: balance can't cover the mandatory tier", () => {
    const r = rankPayables({
      payables: [bill("rent", 16000), emi("emi", 20000, 3375)],
      balance: 30000,
      sortBy: "cost",
    });
    expect(r.mandatory[0].allocated).toBe(16000); // rent paid
    expect(r.mandatory[1].allocated).toBe(0); // EMI (indivisible) can't fit the remaining 14k
    expect(r.mandatory[1].verdict).toBe("defer");
    expect(r.shortfall).toBe(20000);
    expect(r.leftover).toBe(14000); // money is left, but the whole EMI didn't fit
    expect(r.penaltyIncurred).toBe(3375);
  });

  it("tax incentive window: a one-time forfeited discount, flagged non-recurring", () => {
    const r = rankPayables({
      payables: [
        { id: "water", label: "Water tax", kind: "tax_window", amount: 983, divisible: false, mandatoryDefault: false, oneTimeCost: 17 },
      ],
      balance: 2000,
      sortBy: "efficiency",
    });
    const d = r.deferrable[0];
    expect(d.costOfWaiting).toBe(17);
    expect(d.recurring).toBe(false);
    expect(d.efficiency).toBe(1.73); // 17 / 983 × 100
    expect(d.verdict).toBe("pay");
  });

  it("a plain bill with no rate/penalty costs nothing to wait on", () => {
    const r = rankPayables({ payables: [bill("eb", 5000)], balance: 10000, sortBy: "cost" });
    expect(r.mandatory[0].costOfWaiting).toBe(0);
    expect(r.mandatory[0].efficiency).toBe(0);
  });

  it("penaltyAvoided + penaltyIncurred always equals the total cost of waiting", () => {
    const payables = [
      emi("emi", 20000, 3375),
      loanInterest("JL", 100000, 18),
      taxDue("tax", 1185, 11.85),
    ];
    const r = rankPayables({ payables, balance: 35000, sortBy: "efficiency" });
    const totalCost = [...r.mandatory, ...r.deferrable].reduce((s, x) => s + x.costOfWaiting, 0);
    expect(Math.round((r.penaltyAvoided + r.penaltyIncurred) * 100) / 100).toBe(Math.round(totalCost * 100) / 100);
  });

  it("sortBy cost vs efficiency can pick a different item for the same balance", () => {
    const payables: Payable[] = [
      loanInterest("big12", 100000, 12), // cost 1000, efficiency 1.0
      taxDue("small", 5000, 100), // cost 100, efficiency 2.0
    ];
    const byCost = rankPayables({ payables, balance: 5000, sortBy: "cost" });
    const byEff = rankPayables({ payables, balance: 5000, sortBy: "efficiency" });
    // By cost: the big loan ranks first and soaks the 5k (partial). The small tax gets nothing.
    expect(byCost.deferrable[0].id).toBe("big12");
    expect(byCost.deferrable.find((d) => d.id === "small")!.allocated).toBe(0);
    // By efficiency: the small high-% tax ranks first and is paid in full; the loan gets nothing.
    expect(byEff.deferrable[0].id).toBe("small");
    expect(byEff.deferrable.find((d) => d.id === "small")!.allocated).toBe(5000);
    expect(byEff.deferrable.find((d) => d.id === "big12")!.allocated).toBe(0);
  });

  it("override flips a tier and marks it overridden; a no-op override does not", () => {
    const payables: Payable[] = [loanInterest("JL", 50000, 18), bill("rent", 16000)];
    const r = rankPayables({
      payables,
      balance: 100000,
      sortBy: "efficiency",
      overrides: { JL: "mandatory", rent: "mandatory" },
    });
    const jl = [...r.mandatory, ...r.deferrable].find((x) => x.id === "JL")!;
    const rent = [...r.mandatory, ...r.deferrable].find((x) => x.id === "rent")!;
    expect(jl.tier).toBe("mandatory"); // flipped from deferrable
    expect(jl.overridden).toBe(true);
    expect(rent.tier).toBe("mandatory"); // same as default
    expect(rent.overridden).toBe(false); // no-op override is not a flip
  });

  it("balance covering everything pays all, leaves the remainder, incurs no penalty", () => {
    const r = rankPayables({
      payables: [emi("emi", 20000, 3375), taxDue("tax", 1185, 11.85)],
      balance: 50000,
      sortBy: "efficiency",
    });
    expect(r.spent).toBe(21185);
    expect(r.leftover).toBe(28815);
    expect(r.penaltyIncurred).toBe(0);
    expect(r.shortfall).toBe(0);
  });

  it("empty payables → all zeros", () => {
    const r = rankPayables({ payables: [], balance: 10000, sortBy: "cost" });
    expect(r.mandatory).toEqual([]);
    expect(r.deferrable).toEqual([]);
    expect(r.spent).toBe(0);
    expect(r.leftover).toBe(10000);
    expect(r.penaltyAvoided).toBe(0);
    expect(r.penaltyIncurred).toBe(0);
  });
});
