import { describe, expect, it } from "vitest";
import { allocate, memberFlows, type IncomingItem, type QueueItem } from "./inHandCoverage";
import type { PlanStep } from "./moneyPlan";

const q = (key: string, amount: number, day: number | null = null, type: QueueItem["type"] = "bill"): QueueItem => ({ key, type, label: key, amount, day, dueNow: false });
const inc = (key: string, amount: number, day: number | null, extra: Partial<IncomingItem> = {}): IncomingItem => ({ key, label: key, fromName: "A", amount, day, fundsBillKey: null, billLinked: false, income: false, ...extra });

describe("allocate", () => {
  it("covers bills in order only when they fully fit; a partly-covered one holds nothing", () => {
    // Lakshmi today: ₹12,100 in hand, a ₹1,00,000 send first, then VAN 3,000 and CHIT 9,100.
    const r = allocate(12100, 0, [q("xfer", 100000, 2, "send"), q("van", 3000, 5), q("chit", 9100, 10)], [inc("loan", 100000, 2, { income: true })]);
    expect(r.items.map((i) => [i.key, i.covered])).toEqual([["xfer", false], ["van", true], ["chit", true]]);
    expect(r.unassigned).toBe(0);
    const x = r.items[0];
    expect(x.covered).toBe(false);
    if (!x.covered) expect(x.arrives?.day).toBe(2);
  });

  it("fixed holdings are taken first; misc is not part of the plan cash", () => {
    // Baala: plan cash 36,777.47 (holding + ₹90 misc), fixed 34,206.88 → 2,570.59 free, bill 4,200 waits.
    const r = allocate(36777.47, 34206.88, [q("mobile", 4200, 21)], [inc("back", 767, 5)]);
    expect(r.items[0].covered).toBe(false);
    expect(r.unassigned).toBeCloseTo(2570.59, 2);
    const w = r.items[0];
    if (!w.covered) { expect(w.short).toBeCloseTo(1629.41, 2); expect(w.arrives).toBeNull(); }
  });

  it("a waiting item points at the inflow earmarked for it", () => {
    const r = allocate(-11754, 10000, [q("bill-5450", 5450, 4)], [inc("x", 999, 1), inc("disb", 5450, 4, { fundsBillKey: "bill-5450", billLinked: true })]);
    const w = r.items[0];
    expect(w.covered).toBe(false);
    if (!w.covered) expect(w.arrives?.amount).toBe(5450);
    expect(r.unassigned).toBe(-21754);
  });
});

describe("memberFlows", () => {
  const base = { done: false, day: 1, status: null, days: null } as const;
  it("splits a member's pending bills/sends (queue) from inflows; skips fund, miscCard, self and Piggy-income moves", () => {
    const steps = [
      { ...base, id: "b1", kind: "bill", amount: 100, payerId: 1, vendor: "Cook" },
      { ...base, id: "b2", kind: "bill", amount: 50, payerId: 1, fund: true },
      { ...base, id: "b3", kind: "bill", amount: 70, payerId: 1, miscCard: true },
      { ...base, id: "s1", kind: "transfer-in", amount: 500, fromId: 1, toId: 9 },
      { ...base, id: "s2", kind: "allowance", amount: 40, fromId: 1, toId: 1 },
      { ...base, id: "s3", kind: "pool-handover", amount: 30, fromId: 1, toId: 9, piggyIncomeIds: [1] },
      { ...base, id: "i1", kind: "income", amount: 1000, toId: 1, source: "Salary" },
      { ...base, id: "t1", kind: "transfer-out", amount: 200, fromId: 9, toId: 1, fundsMember: true },
      { ...base, id: "x", kind: "bill", amount: 1, payerId: 2, done: false },
      { ...base, id: "d", kind: "bill", amount: 1, payerId: 1, done: true },
    ] as unknown as PlanStep[];
    const { queue, incoming } = memberFlows(steps, 1, 9, 2, 120);
    expect(queue.map((x) => [x.key, x.amount])).toEqual([["b1", 100], ["s1", 380]]); // 500 − 120 already routed manually
    expect(queue[0].dueNow).toBe(true); // day 1 ≤ today 2
    expect(incoming.map((x) => [x.key, x.income, x.billLinked])).toEqual([["i1", true, false], ["t1", false, true]]);
  });
});
