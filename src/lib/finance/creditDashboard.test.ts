import { describe, it, expect } from "vitest";
import { currentCycle } from "@/lib/finance/cycle";
import { computeCreditDashboard } from "@/lib/finance/creditDashboard";
import type { LedgerTxn } from "@/lib/finance/types";

const d = (s: string) => new Date(s + "T12:00:00");

describe("currentCycle", () => {
  it("statementDay 15, mid-cycle → 16 May..15 Jun with due date", () => {
    const c = currentCycle(15, d("2026-06-02"), 18);
    expect(c.start.getMonth()).toBe(4); // May (0-based)
    expect(c.start.getDate()).toBe(16);
    expect(c.end.getMonth()).toBe(5); // June
    expect(c.end.getDate()).toBe(15);
    expect(c.statementDate.getTime()).toBe(c.end.getTime());
    expect(c.dueDate!.getMonth()).toBe(6); // 15 Jun + 18 = 3 Jul
    expect(c.dueDate!.getDate()).toBe(3);
  });

  it("past the statement day → cycle closes next month", () => {
    const c = currentCycle(15, d("2026-06-20"));
    expect(c.start.getDate()).toBe(16); // 16 Jun
    expect(c.start.getMonth()).toBe(5);
    expect(c.end.getDate()).toBe(15); // 15 Jul
    expect(c.end.getMonth()).toBe(6);
    expect(c.dueDate).toBeNull();
  });

  it("crosses the year boundary", () => {
    const c = currentCycle(10, d("2026-12-20"));
    expect(c.start.getFullYear()).toBe(2026);
    expect(c.start.getMonth()).toBe(11); // 11 Dec
    expect(c.end.getFullYear()).toBe(2027);
    expect(c.end.getMonth()).toBe(0); // 10 Jan
  });

  it("clamps statementDay above 28", () => {
    const c = currentCycle(31, d("2026-06-02"));
    expect(c.end.getDate()).toBe(28);
  });
});

describe("computeCreditDashboard", () => {
  const txns: LedgerTxn[] = [
    { date: d("2026-05-10"), amount: 10000, type: "spend" }, // prev cycle (before 16 May)
    { date: d("2026-05-12"), amount: 5000, type: "payment" }, // prev cycle
    { date: d("2026-06-05"), amount: 3000, type: "spend" }, // this cycle
    { date: d("2026-06-08"), amount: 2000, type: "spend", rewardPoints: 20 }, // this cycle
    { date: d("2026-06-10"), amount: 150, type: "cashback" }, // this cycle
    { date: d("2026-06-12"), amount: 8000, type: "payment" }, // this cycle
  ];

  it("outstanding = owed-up minus owed-down across ALL txns", () => {
    const r = computeCreditDashboard({ creditLimit: 100000, statementDay: 15, dueOffsetDays: 18, txns, now: d("2026-06-12") });
    // 10000 + 3000 + 2000 spends − 5000 − 8000 payments − 150 cashback = 1850
    expect(r.outstanding).toBe(1850);
    expect(r.available).toBe(98150);
    expect(r.utilPct).toBeCloseTo(1.85, 5);
  });

  it("this-cycle figures use only the in-progress window (16 May..15 Jun)", () => {
    const r = computeCreditDashboard({ creditLimit: 100000, statementDay: 15, dueOffsetDays: 18, txns, now: d("2026-06-12") });
    expect(r.spentThisCycle).toBe(5000); // 3000 + 2000 (the 20 May spend is prev cycle)
    expect(r.paymentsThisCycle).toBe(8000); // only the 12 Jun payment
    expect(r.cashbackThisCycle).toBe(150);
    expect(r.pointsThisCycle).toBe(20);
  });

  it("lifetime cashback/points span all txns", () => {
    const r = computeCreditDashboard({ creditLimit: 100000, statementDay: 15, txns, now: d("2026-06-12") });
    expect(r.lifetimeCashback).toBe(150);
    expect(r.lifetimePoints).toBe(20);
  });

  it("no limit / no statement day → nulls + flags, never NaN", () => {
    const r = computeCreditDashboard({ txns, now: d("2026-06-12") });
    expect(r.hasLimit).toBe(false);
    expect(r.available).toBeNull();
    expect(r.utilPct).toBeNull();
    expect(r.hasCycle).toBe(false);
    expect(r.cycle).toBeNull();
    expect(r.spentThisCycle).toBe(0);
    expect(Number.isNaN(r.outstanding)).toBe(false);
  });
});
