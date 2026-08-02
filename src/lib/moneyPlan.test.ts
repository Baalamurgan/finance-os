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

  it("a dated fund bill is net-neutral to the hub (paid from its fund, not collected cash)", () => {
    // Fund bill due on the 2nd (before any income arrives on the 5th); it must NOT flag a hub short.
    const plan = buildMoneyPlan({
      treasurerId: T,
      transfers: [xfer({ fromId: 2, toId: T, amount: 100 })],
      bills: [bill({ payerId: T, vendor: "EB", amount: 4000, day: 2, fund: true, fundAvail: 4000 })],
      incomeDayByMember: { 2: 5 },
    });
    const eb = plan.steps.find((s) => s.vendor === "EB")!;
    expect(eb.day).toBe(2); // dated → sorts by its due day
    expect(eb.hubAfter).toBeUndefined(); // never touches the hub
    expect(plan.hubShortfall).toBe(0); // no phantom shortfall
  });

  it("disburses an allowance after collection — never dated, subtracts from the hub", () => {
    const plan = buildMoneyPlan({
      treasurerId: T,
      treasurerName: "A",
      transfers: [xfer({ fromId: 2, from: "B", toId: T, amount: 100, settled: true })], // hub +100 on day 1
      bills: [],
      allowances: [{ key: "allow-1", recipientId: 3, recipientName: "Harish", amount: 40, done: false, billId: 99 }],
      incomeDayByMember: { 2: 1 },
    });
    // income-in first, allowance disbursed after collection (last)
    expect(plan.steps.map((s) => s.kind)).toEqual(["transfer-in", "allowance"]);
    const a = plan.steps.find((s) => s.kind === "allowance")!;
    expect(a.status).toBeNull(); // never overdue
    expect(a.toId).toBe(3);
    expect(a.billId).toBe(99);
    expect(a.hubAfter).toBe(60); // 100 collected − 40 sent
    expect(plan.hubShortfall).toBe(0);
  });

  it("piggy returns sink to dead last, don't touch the hub, and aren't counted in progress", () => {
    const plan = buildMoneyPlan({
      treasurerId: T,
      transfers: [xfer({ fromId: 2, toId: T, amount: 100, settled: true })],
      bills: [bill({ vendor: "Undated", amount: 10, day: null, payerId: 5 })],
      piggyReturns: [{ key: "piggy-5", fromId: 5, fromName: "E", toId: 9, toName: "Baala", amount: 3171 }],
      incomeDayByMember: { 2: 1 },
    });
    // piggy return is the very last step, below even the undated bill
    expect(plan.steps[plan.steps.length - 1].kind).toBe("piggy");
    const pg = plan.steps.find((s) => s.kind === "piggy")!;
    expect(pg.hubAfter).toBeUndefined(); // never touches the hub
    expect(pg.actorLeft).toBe(0); // it's E's last outflow
    // progress counts real steps only (transfer-in + bill = 2), not the piggy projection
    expect(plan.total).toBe(2);
    expect(plan.done).toBe(1);
  });

  it("tracks each member's running cash position after every step", () => {
    const plan = buildMoneyPlan({
      treasurerId: T,
      transfers: [xfer({ fromId: 2, from: "B", toId: T, amount: 100 })], // B → hub 100
      bills: [bill({ payerId: 2, payerName: "B", vendor: "Cook", amount: 30, day: 2 })], // B pays 30
      incomeDayByMember: { 2: 1 },
    });
    const last = plan.steps[plan.steps.length - 1];
    // B handed 100 to the hub then paid 30 out → −130; the treasurer (hub) holds +100.
    expect(last.balancesAfter?.[2]).toBe(-130);
    expect(last.balancesAfter?.[T]).toBe(100);
  });

  it("seeds each member from their own income and flags a sender who can't cover a step", () => {
    const plan = buildMoneyPlan({
      treasurerId: T,
      transfers: [],
      bills: [bill({ payerId: 5, payerName: "E", vendor: "Rent", amount: 100, day: 2 })], // E pays 100
      incomeDayByMember: {},
      incomeByMember: {}, // E has no income and no disbursement → can't cover
    });
    const b = plan.steps.find((s) => s.vendor === "Rent")!;
    expect(b.senderShort).toBe(100);
  });

  it("pulls a member's disbursement up to fund their bills, clearing the shortfall", () => {
    const plan = buildMoneyPlan({
      treasurerId: T,
      transfers: [
        xfer({ fromId: 2, from: "B", toId: T, amount: 200, settled: false }), // B → hub 200 on day 1
        xfer({ fromId: T, from: "A", toId: 3, to: "H", amount: 120 }), // hub → Harish 120 (disbursement)
      ],
      bills: [bill({ payerId: 3, payerName: "H", vendor: "Loan", amount: 100, day: 5 })], // Harish pays 100 due day 5
      incomeDayByMember: { 2: 1 },
      incomeByMember: {}, // Harish has no own income — relies on the disbursement
    });
    const kinds = plan.steps.map((s) => s.kind);
    // income in → funding disbursement → the member's bill
    expect(kinds).toEqual(["transfer-in", "transfer-out", "bill"]);
    const disb = plan.steps.find((s) => s.kind === "transfer-out")!;
    expect(disb.fundsMember).toBe(true);
    const loan = plan.steps.find((s) => s.vendor === "Loan")!;
    expect(loan.senderShort).toBeUndefined(); // funded first → not short
    expect(loan.balancesAfter?.[3]).toBe(20); // 120 received − 100 paid
  });

  it("counts the treasurer's own income so his own bills don't phantom-flag a shortfall", () => {
    const plan = buildMoneyPlan({
      treasurerId: T,
      transfers: [],
      bills: [bill({ payerId: T, vendor: "Rent", amount: 100, day: null })], // undated, hub pays 100
      incomeDayByMember: {},
      incomeByMember: { [T]: 500 }, // treasurer holds 500 of his own salary
    });
    expect(plan.hubShortfall).toBe(0);
    const b = plan.steps.find((s) => s.vendor === "Rent")!;
    expect(b.hubAfter).toBe(400); // 500 own − 100 paid; hubAfter == his real cash
  });

  it("collects undated inbound before undated outflows, so the hub isn't phantom-short", () => {
    const plan = buildMoneyPlan({
      treasurerId: T,
      transfers: [xfer({ fromId: 2, toId: T, amount: 100 })], // undated inbound (no income day)
      bills: [bill({ payerId: T, vendor: "Rent", amount: 80, day: null })], // undated hub bill
      incomeDayByMember: {}, // no income days at all
    });
    expect(plan.steps.map((s) => s.kind)).toEqual(["transfer-in", "bill"]); // money in, THEN money out
    expect(plan.hubShortfall).toBe(0);
  });

  it("does not pull a disbursement early to cover a fund bill (paid from sinking, not cash)", () => {
    const plan = buildMoneyPlan({
      treasurerId: T,
      transfers: [
        xfer({ fromId: 2, toId: T, amount: 10 }),
        xfer({ fromId: T, from: "A", toId: 3, to: "H", amount: 50 }), // disbursement to H
      ],
      bills: [bill({ payerId: 3, payerName: "H", vendor: "Insurance", amount: 40, day: 1, fund: true, fundAvail: 40 })],
      incomeDayByMember: { 2: 10 }, // inbound arrives day 10 → lastDay = 10
    });
    const disb = plan.steps.find((s) => s.kind === "transfer-out")!;
    expect(disb.fundsMember).toBeFalsy(); // a day-1 FUND bill must NOT drag the disbursement early
    expect(disb.day).toBe(10); // stays at lastDay, not pulled to day 1
  });

  it("flags a hub shortfall when an allowance is sent but nothing was collected", () => {
    const plan = buildMoneyPlan({
      treasurerId: T,
      treasurerName: "A",
      transfers: [],
      bills: [],
      allowances: [{ key: "allow-1", recipientId: 3, recipientName: "Harish", amount: 40, done: false, billId: 99 }],
      incomeDayByMember: {},
    });
    expect(plan.hubShortfall).toBe(40);
  });
});
