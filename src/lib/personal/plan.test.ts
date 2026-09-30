import { describe, it, expect } from "vitest";
import { buildRecurringMoves, type PlanItemLite } from "./plan";

const names: Record<number, string> = { 1: "HDFC", 2: "ICICI", 3: "Salary" };
const nameOf = (id: number | null) => (id == null ? null : names[id] ?? null);

const transfer = (over: Partial<PlanItemLite> = {}): PlanItemLite => ({
  id: 1, kind: "transfer", label: "EMI move", amount: 20000, dayOfMonth: 5,
  fromAccountId: 1, toAccountId: 2, sortOrder: 0, ...over,
});
const save = (over: Partial<PlanItemLite> = {}): PlanItemLite => ({
  id: 2, kind: "save", label: "Monthly savings", amount: 10000, dayOfMonth: null,
  fromAccountId: 3, toAccountId: null, sortOrder: 0, ...over,
});

describe("buildRecurringMoves", () => {
  it("marks a transfer done when a matching transfer_out on the source exists this month", () => {
    const [m] = buildRecurringMoves([transfer()], [{ accountId: 1, amount: 20000 }], [], nameOf);
    expect(m.done).toBe(true);
    expect(m.fromName).toBe("HDFC");
    expect(m.toName).toBe("ICICI");
  });

  it("is not done when the amount differs", () => {
    const [m] = buildRecurringMoves([transfer()], [{ accountId: 1, amount: 19999 }], [], nameOf);
    expect(m.done).toBe(false);
  });

  it("is not done when the transfer left a different account", () => {
    const [m] = buildRecurringMoves([transfer()], [{ accountId: 2, amount: 20000 }], [], nameOf);
    expect(m.done).toBe(false);
  });

  it("marks a save done when a matching savings deposit exists this month", () => {
    const [m] = buildRecurringMoves([save()], [], [{ amount: 10000 }], nameOf);
    expect(m.done).toBe(true);
    expect(m.toName).toBeNull();
  });

  it("a save is not done off a same-amount transfer (and vice-versa)", () => {
    const [s] = buildRecurringMoves([save()], [{ accountId: 3, amount: 10000 }], [], nameOf);
    expect(s.done).toBe(false);
  });

  it("rounds to paise when matching (float safety)", () => {
    // both normalise to 100.10 despite float noise
    const [m] = buildRecurringMoves([transfer({ amount: 100.1 })], [{ accountId: 1, amount: 100.099999999 }], [], nameOf);
    expect(m.done).toBe(true);
  });

  it("orders dated moves by day, then undated moves after", () => {
    const items = [
      save({ id: 10, dayOfMonth: null, sortOrder: 0 }),
      transfer({ id: 11, dayOfMonth: 15, sortOrder: 0 }),
      transfer({ id: 12, dayOfMonth: 2, sortOrder: 0 }),
    ];
    const order = buildRecurringMoves(items, [], [], nameOf).map((m) => m.id);
    expect(order).toEqual([12, 11, 10]);
  });
});
