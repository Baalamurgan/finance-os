import { describe, it, expect } from "vitest";
import { monthEndInfo } from "./monthEnd";

describe("monthEndInfo", () => {
  it("counts to the real last day, labelled with the month of the clock", () => {
    // 26 Nov 2026, 10:00 IST
    const i = monthEndInfo(Date.UTC(2026, 10, 26, 4, 30));
    expect(i).toMatchObject({ daysUntil: 4, lastDay: 30, monthLabel: "November" });
    expect(i.dateStr).toBe("30 Nov");
  });
  it("uses IST, not UTC, around midnight", () => {
    // 30 Nov 20:00 UTC = 1 Dec 01:30 IST → December, 30 days left
    const i = monthEndInfo(Date.UTC(2026, 10, 30, 20, 0));
    expect(i.monthLabel).toBe("December");
    expect(i.daysUntil).toBe(30);
  });
  it("handles Feb in a non-leap year", () => {
    expect(monthEndInfo(Date.UTC(2027, 1, 25, 6, 0))).toMatchObject({ lastDay: 28, daysUntil: 3, monthLabel: "February" });
  });
});
