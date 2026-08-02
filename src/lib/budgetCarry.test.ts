import { describe, it, expect } from "vitest";
import { budgetShortfallReductions } from "./budgetCarry";

describe("budgetShortfallReductions", () => {
  it("surplus absorbs the overspend; only the remainder hits the category", () => {
    // July: sheet surplus ₹650, Provision overspent ₹775 → net ₹125 charged to Provision
    const r = budgetShortfallReductions({ surplus: 650, overspendByCat: { 1: 775 } });
    expect(r.netShortfall).toBe(125);
    expect(r.reductionByCat[1]).toBe(125);
  });

  it("surplus fully covers the overspend → no reduction", () => {
    const r = budgetShortfallReductions({ surplus: 1000, overspendByCat: { 1: 775 } });
    expect(r.netShortfall).toBe(0);
    expect(r.reductionByCat).toEqual({});
  });

  it("allocates the shortfall proportionally across overspent categories", () => {
    const r = budgetShortfallReductions({ surplus: 0, overspendByCat: { 1: 300, 2: 100 } });
    expect(r.netShortfall).toBe(400);
    expect(r.reductionByCat[1]).toBe(300);
    expect(r.reductionByCat[2]).toBe(100);
  });

  it("a carried-in shortfall (negative surplus) increases what the categories owe", () => {
    const r = budgetShortfallReductions({ surplus: -50, overspendByCat: { 1: 100 } });
    expect(r.netShortfall).toBe(150);
    expect(r.reductionByCat[1]).toBe(150);
  });
});
