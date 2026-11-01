import { describe, it, expect } from "vitest";
import { buildAllocation } from "./allocation";

describe("buildAllocation", () => {
  it("uses the Budget row planned when present", () => {
    expect(buildAllocation([{ categoryId: 1, planned: 5000 }], []).get(1)).toBe(5000);
  });

  it("falls back to a miscCard envelope when there is no Budget row (the Ayudha Pooja case)", () => {
    const m = buildAllocation([], [{ categoryId: 46, amount: 1000 }]);
    expect(m.get(46)).toBe(1000);
  });

  it("fills a 0 Budget row from the envelope too", () => {
    expect(buildAllocation([{ categoryId: 46, planned: 0 }], [{ categoryId: 46, amount: 1000 }]).get(46)).toBe(1000);
  });

  it("prefers the Budget row over the envelope", () => {
    expect(buildAllocation([{ categoryId: 1, planned: 5000 }], [{ categoryId: 1, amount: 1000 }]).get(1)).toBe(5000);
  });

  it("ignores non-positive envelopes and null categories", () => {
    const m = buildAllocation([], [{ categoryId: 2, amount: 0 }, { categoryId: null, amount: 500 }]);
    expect(m.get(2)).toBeUndefined();
  });
});
