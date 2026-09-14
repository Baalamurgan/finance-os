import { describe, it, expect } from "vitest";
import { computeBalance } from "./balance";

const d = new Date("2026-09-01");
const t = (type: string, amount: number) => ({ date: d, amount, type });

describe("computeBalance (debit/prepaid)", () => {
  it("starts at the opening balance with no txns", () => {
    expect(computeBalance(500, [])).toBe(500);
    expect(computeBalance(null, [])).toBe(0);
  });

  it("top-ups and refunds raise it; spends and fees lower it", () => {
    const bal = computeBalance(1000, [
      t("spend", 200),
      t("topup", 500),
      t("fee", 10),
      t("refund", 50),
    ]);
    expect(bal).toBe(1000 - 200 + 500 - 10 + 50); // 1340
  });

  it("adjustment reconciles upward; unknown/reward types are ignored", () => {
    expect(computeBalance(100, [t("adjustment", 25), t("reward", 999)])).toBe(125);
  });

  it("can go negative (overdrawn) and rounds float drift to paise", () => {
    expect(computeBalance(0, [t("spend", 10.01)])).toBe(-10.01);
    expect(computeBalance(0, [t("topup", 0.1), t("topup", 0.2)])).toBe(0.3);
  });
});
