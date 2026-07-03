import { describe, it, expect } from "vitest";
import { formatINR } from "@/lib/format";

describe("formatINR", () => {
  it("formats with the ₹ symbol and Indian grouping", () => {
    const s = formatINR(174451);
    expect(s).toContain("₹");
    expect(s).toContain("1,74,451");
  });
  it("handles zero", () => {
    expect(formatINR(0)).toContain("0");
  });
});
