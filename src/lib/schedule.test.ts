import { describe, it, expect } from "vitest";
import { scheduleOccurrence, scheduleLabel, isLumpDue, planBillMonth, monthsUntilNextDue } from "@/lib/schedule";

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

describe("planBillMonth — goal-based 'bill with a fund' (₹12,000 car insurance, due July)", () => {
  const base = { billAmount: 12000, billMonth: 7, everyMonths: 12, fundingStyle: "auto" as const };

  it("auto-save spreads from the month after the last bill (Aug → 11 months)", () => {
    expect(planBillMonth({ ...base, fund: 0, month: 8 })).toEqual({ kind: "save", contribution: 1090.91 });
    expect(monthsUntilNextDue(7, 12, 8)).toBe(11);
  });

  it("auto-save stays ~level when the fund is on-track", () => {
    // June, one month left, fund at 10,909 → tops up the last 1,091
    expect(planBillMonth({ ...base, fund: 10909, month: 6 })).toEqual({ kind: "save", contribution: 1091 });
  });

  it("auto due month → sets aside a normal share (the bill is paid from the fund in In Hand, not a Sheet line)", () => {
    // July is the due month; auto no longer drops the full bill — it sets aside the normal ~1,000 share
    expect(planBillMonth({ ...base, fund: 12000, month: 7 })).toEqual({ kind: "save", contribution: 1000 });
    expect(planBillMonth({ ...base, fund: 0, month: 7 })).toEqual({ kind: "save", contribution: 1000 });
  });

  it("Q3 — withdrew from the fund → next month's save jumps to catch up", () => {
    // Jan, 6 months to July, fund dropped to 2,000 → (12000−2000)/6 ≈ 1,667 (vs the ~1,091 level)
    expect(planBillMonth({ ...base, fund: 2000, month: 1 })).toEqual({ kind: "save", contribution: 1666.67 });
  });

  it("Q1 — switch to pay-in-full mid-cycle → only the shortfall is out-of-pocket", () => {
    // fund 6,000 saved, style now none → nothing in saving months
    expect(planBillMonth({ ...base, fundingStyle: "none", fund: 6000, month: 3 })).toEqual({ kind: "none" });
    // at July: 12,000 bill − 6,000 fund = 6,000 out of pocket
    expect(planBillMonth({ ...base, fundingStyle: "none", fund: 6000, month: 7 })).toEqual({ kind: "bill", bill: 12000, fromFund: 6000, outOfPocket: 6000 });
  });

  it("Q2 — switch to auto with 3 months left and nothing saved → bill ÷ 3", () => {
    // April → 3 months to July, fund 0 → 12,000 / 3 = 4,000 each for Apr/May/Jun
    expect(planBillMonth({ ...base, fund: 0, month: 4 })).toEqual({ kind: "save", contribution: 4000 });
    expect(monthsUntilNextDue(7, 12, 4)).toBe(3);
  });

  it("non-due month with fund already ≥ bill → contributes 0 (nothing more needed)", () => {
    expect(planBillMonth({ ...base, fund: 12000, month: 5 })).toEqual({ kind: "save", contribution: 0 });
  });

  it("no saveEveryMonths given → monthly cadence (back-compat with the cases above)", () => {
    expect(planBillMonth({ ...base, fund: 0, month: 8 })).toEqual({ kind: "save", contribution: 1090.91 });
  });
});

describe("planBillMonth — save cadence (yearly ₹12,000 due July)", () => {
  const base = { billAmount: 12000, billMonth: 7, everyMonths: 12, fundingStyle: "auto" as const };

  it("save quarterly → only Oct / Jan / Apr contribute (₹4,000 each), fund fills by July", () => {
    // save months are those whose distance to July is a multiple of 3: Oct(9), Jan(6), Apr(3)
    expect(planBillMonth({ ...base, saveEveryMonths: 3, fund: 0, month: 10 })).toEqual({ kind: "save", contribution: 4000 });
    expect(planBillMonth({ ...base, saveEveryMonths: 3, fund: 4000, month: 1 })).toEqual({ kind: "save", contribution: 4000 });
    expect(planBillMonth({ ...base, saveEveryMonths: 3, fund: 8000, month: 4 })).toEqual({ kind: "save", contribution: 4000 });
  });

  it("save quarterly → off-cadence months set aside nothing", () => {
    for (const m of [8, 9, 11, 12, 2, 3, 5, 6]) {
      expect(planBillMonth({ ...base, saveEveryMonths: 3, fund: 0, month: m })).toEqual({ kind: "none" });
    }
  });

  it("save quarterly → the due month sets aside a normal share (¼ of the year), not the bill", () => {
    expect(planBillMonth({ ...base, saveEveryMonths: 3, fund: 12000, month: 7 })).toEqual({ kind: "save", contribution: 3000 });
  });

  it("save every 6 months → a single ₹12,000 set-aside in January", () => {
    expect(planBillMonth({ ...base, saveEveryMonths: 6, fund: 0, month: 1 })).toEqual({ kind: "save", contribution: 12000 });
    expect(planBillMonth({ ...base, saveEveryMonths: 6, fund: 0, month: 4 })).toEqual({ kind: "none" });
  });

  it("6-monthly bill saved every 2 months (₹6,000, due Jan & Jul) → Mar/May contribute ₹3,000", () => {
    const six = { billAmount: 6000, billMonth: 7, everyMonths: 6, fundingStyle: "auto" as const, saveEveryMonths: 2 };
    // everyMonths 6 anchored to Jul → due Jan AND Jul; save months (distance-to-due ÷ 2) = Mar(4), May(2)
    expect(planBillMonth({ ...six, fund: 0, month: 3 })).toEqual({ kind: "save", contribution: 3000 });
    expect(planBillMonth({ ...six, fund: 3000, month: 5 })).toEqual({ kind: "save", contribution: 3000 });
    expect(planBillMonth({ ...six, fund: 0, month: 4 })).toEqual({ kind: "none" }); // off-cadence
    expect(planBillMonth({ ...six, fund: 6000, month: 1 })).toEqual({ kind: "save", contribution: 2000 }); // Jan is a due month → normal share (⅓ of 6,000), not the bill
  });
});

describe("scheduleLabel", () => {
  it("shows N/total only for capped runs", () => {
    expect(scheduleLabel("Chimney EMI", 6, 3)).toBe("Chimney EMI 3/6");
    expect(scheduleLabel("Health insurance", null, null)).toBe("Health insurance");
    expect(scheduleLabel("Health insurance", null, 2)).toBe("Health insurance"); // periodic forever
  });
});
