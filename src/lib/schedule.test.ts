import { describe, it, expect } from "vitest";
import { scheduleOccurrence, scheduleLabel, isLumpDue } from "@/lib/schedule";

const P = (year: number, month: number) => ({ year, month });

describe("scheduleOccurrence", () => {
  it("no anchor → due every month", () => {
    const s = { intervalMonths: 1 };
    expect(scheduleOccurrence(s, P(2026, 7)).due).toBe(true);
    expect(scheduleOccurrence(s, P(2030, 1)).due).toBe(true);
  });

  it("installment (interval 1, total 6) — the existing EMI behaviour, unchanged", () => {
    const s = { intervalMonths: 1, installmentsTotal: 6, installmentStartYear: 2026, installmentStartMonth: 6 }; // JUN..NOV
    expect(scheduleOccurrence(s, P(2026, 5)).due).toBe(false); // before start
    expect(scheduleOccurrence(s, P(2026, 6))).toEqual({ due: true, n: 1 });
    expect(scheduleOccurrence(s, P(2026, 8))).toEqual({ due: true, n: 3 });
    expect(scheduleOccurrence(s, P(2026, 11))).toEqual({ due: true, n: 6 });
    expect(scheduleOccurrence(s, P(2026, 12)).due).toBe(false); // past the last
  });

  it("yearly (interval 12) anchored to July — due only every July, forever", () => {
    const s = { intervalMonths: 12, installmentStartYear: 2026, installmentStartMonth: 7 };
    expect(scheduleOccurrence(s, P(2026, 7)).due).toBe(true);
    expect(scheduleOccurrence(s, P(2026, 8)).due).toBe(false);
    expect(scheduleOccurrence(s, P(2027, 6)).due).toBe(false);
    expect(scheduleOccurrence(s, P(2027, 7))).toEqual({ due: true, n: 2 });
    expect(scheduleOccurrence(s, P(2036, 7)).due).toBe(true);
  });

  it("every 2 months anchored to Aug — Aug, Oct, Dec, Feb…", () => {
    const s = { intervalMonths: 2, installmentStartYear: 2026, installmentStartMonth: 8 };
    expect(scheduleOccurrence(s, P(2026, 8)).due).toBe(true);
    expect(scheduleOccurrence(s, P(2026, 9)).due).toBe(false);
    expect(scheduleOccurrence(s, P(2026, 10)).due).toBe(true);
    expect(scheduleOccurrence(s, P(2026, 12)).due).toBe(true);
    expect(scheduleOccurrence(s, P(2027, 2))).toEqual({ due: true, n: 4 });
  });

  it("periodic with a cap (every 6 months, 3 times) then stops", () => {
    const s = { intervalMonths: 6, installmentsTotal: 3, installmentStartYear: 2026, installmentStartMonth: 1 }; // Jan26, Jul26, Jan27
    expect(scheduleOccurrence(s, P(2026, 1))).toEqual({ due: true, n: 1 });
    expect(scheduleOccurrence(s, P(2026, 7))).toEqual({ due: true, n: 2 });
    expect(scheduleOccurrence(s, P(2027, 1))).toEqual({ due: true, n: 3 });
    expect(scheduleOccurrence(s, P(2027, 7)).due).toBe(false); // 4th is past the cap
  });

  it("crosses the year boundary correctly", () => {
    const s = { intervalMonths: 12, installmentStartYear: 2026, installmentStartMonth: 12 };
    expect(scheduleOccurrence(s, P(2027, 12))).toEqual({ due: true, n: 2 });
    expect(scheduleOccurrence(s, P(2027, 11)).due).toBe(false);
  });
});

describe("isLumpDue (full-bill categories)", () => {
  it("yearly (12) anchored to July → only July", () => {
    for (let m = 1; m <= 12; m++) expect(isLumpDue(7, 12, { month: m })).toBe(m === 7);
  });
  it("every 2 months anchored to Aug → Aug, Oct, Dec, Feb, Apr, Jun", () => {
    const due = [2, 4, 6, 8, 10, 12];
    for (let m = 1; m <= 12; m++) expect(isLumpDue(8, 2, { month: m })).toBe(due.includes(m));
  });
  it("half-yearly (6) anchored to March → Mar & Sep", () => {
    for (let m = 1; m <= 12; m++) expect(isLumpDue(3, 6, { month: m })).toBe(m === 3 || m === 9);
  });
  it("quarterly (3) anchored to Jan → Jan, Apr, Jul, Oct", () => {
    for (let m = 1; m <= 12; m++) expect(isLumpDue(1, 3, { month: m })).toBe([1, 4, 7, 10].includes(m));
  });
});

describe("scheduleLabel", () => {
  it("shows N/total only for capped runs", () => {
    expect(scheduleLabel("Chimney EMI", 6, 3)).toBe("Chimney EMI 3/6");
    expect(scheduleLabel("Health insurance", null, null)).toBe("Health insurance");
    expect(scheduleLabel("Health insurance", null, 2)).toBe("Health insurance"); // periodic forever
  });
});
