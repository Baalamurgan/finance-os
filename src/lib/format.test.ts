import { describe, it, expect } from "vitest";
import { formatINR, parseAmount } from "@/lib/format";

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

describe("parseAmount", () => {
  it("accepts Indian comma grouping and ₹/spaces", () => {
    expect(parseAmount("1,00,000")).toBe(100000);
    expect(parseAmount("₹5,000")).toBe(5000);
    expect(parseAmount(" 2,50,000 ")).toBe(250000);
    expect(parseAmount("1,234.50")).toBe(1234.5);
  });
  it("is identical to Number() for plain numbers", () => {
    expect(parseAmount("5000")).toBe(5000);
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("12.75")).toBe(12.75);
  });
  it("returns NaN for empty/invalid so callers' guards still fire", () => {
    expect(Number.isNaN(parseAmount(""))).toBe(true);
    expect(Number.isNaN(parseAmount(null))).toBe(true);
    expect(Number.isNaN(parseAmount("abc"))).toBe(true);
  });
});
