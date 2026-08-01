import { describe, expect, it } from "vitest";
import { buildMoneyPlan, type PlanTransfer, type PlanBill } from "./moneyPlan";

const T = 1; // treasurer id
const xfer = (o: Partial<PlanTransfer>): PlanTransfer => ({ fromId: 2, from: "B", toId: T, to: "A", amount: 100, settled: false, recordId: null, ...o });
const bill = (o: Partial<PlanBill>): PlanBill => ({ key: `k${Math.random()}`, payerId: T, payerName: "A", vendor: "JL1", amount: 50, done: false, day: null, status: null, ...o });

describe("buildMoneyPlan", () => {
  it("orders income-in → bills → disbursement-out and counts progress", () => {
    const plan = buildMoneyPlan({
      treasurerId: T,
      transfers: [xfer({ fromId: 2, toId: T, amount: 50, settled: true }), xfer({ fromId: T, from: "A", toId: 3, to: "C", amount: 20 })],
      bills: [bill({ payerId: T, vendor: "Rent", amount: 40, day: 2 })],
      incomeDayByMember: { 2: 1 },
    });
    expect(plan.steps.map((s) => s.kind)).toEqual(["transfer-in", "bill", "transfer-out"]);
    expect(plan.total).toBe(3);
    expect(plan.done).toBe(1); // the settled inbound transfer
  });

  it("flags a hub shortfall when an outflow runs before enough has arrived", () => {
    // treasurer must pay a 50 bill on the 1st, but only 30 arrives (on the 1st)
    const plan = buildMoneyPlan({
      treasurerId: T,
      transfers: [xfer({ fromId: 2, toId: T, amount: 30 })],
      bills: [bill({ payerId: T, vendor: "Loan", amount: 50, day: 1 })],
      incomeDayByMember: { 2: 1 },
    });
    expect(plan.hubShortfall).toBe(20);
    const billStep = plan.steps.find((s) => s.kind === "bill");
    expect(billStep?.short).toBe(20);
  });

  it("sinks undated bills to the bottom — no due date = lowest priority", () => {
    const plan = buildMoneyPlan({
      treasurerId: T,
      transfers: [xfer({ fromId: 2, toId: T, amount: 100 })],
      bills: [bill({ vendor: "Undated", amount: 10, day: null, payerId: 5 }), bill({ vendor: "Dated", amount: 20, day: 3, payerId: 5 })],
      incomeDayByMember: { 2: 1 },
    });
    // transfer-in (day 1) → Dated bill (day 3) → Undated bill (no date, last)
    expect(plan.steps.map((s) => s.vendor ?? s.kind)).toEqual(["transfer-in", "Dated", "Undated"]);
  });

  it("tracks the hub running balance and each member's remaining outflow", () => {
    const plan = buildMoneyPlan({
      treasurerId: T,
      transfers: [xfer({ fromId: 2, from: "B", toId: T, amount: 50 })], // B → hub 50
      bills: [
        bill({ payerId: T, vendor: "Rent", amount: 30, day: 2 }), // hub pays 30
        bill({ payerId: 2, payerName: "B", vendor: "Chit", amount: 20, day: 2 }), // B pays 20
        bill({ payerId: 2, payerName: "B", vendor: "Cook", amount: 5, day: 3 }), // B pays 5
      ],
      incomeDayByMember: { 2: 1 },
    });
    const byKind = Object.fromEntries(plan.steps.map((s) => [s.vendor ?? s.kind, s]));
    expect(byKind["transfer-in"].hubAfter).toBe(50); // collected
    expect(byKind["Rent"].hubAfter).toBe(20); // 50 − 30, hub pays it
    expect(byKind["Chit"].hubAfter).toBeUndefined(); // member-paid, never touches the hub
    // B's remaining outflow: transfer 50 + Chit 20 + Cook 5 = 75 total; after Chit → 5, after Cook → 0
    expect(byKind["Chit"].actorLeft).toBe(5);
    expect(byKind["Cook"].actorLeft).toBe(0);
  });

  it("a bill paid by a non-treasurer member doesn't touch the hub balance", () => {
    const plan = buildMoneyPlan({
      treasurerId: T,
      transfers: [],
      bills: [bill({ payerId: 5, payerName: "E", vendor: "Cook", amount: 999, day: 1 })],
      incomeDayByMember: {},
    });
    expect(plan.hubShortfall).toBe(0);
  });
});
