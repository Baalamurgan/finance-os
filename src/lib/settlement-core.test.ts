import { describe, it, expect } from "vitest";
import { computeSettlement, type SettleTagged } from "@/lib/settlement-core";

const members = [
  { id: 1, name: "Bala" },
  { id: 2, name: "Harish" },
  { id: 3, name: "KA" }, // treasurer/hub
];
const exp = (memberId: number | null, amount: number, label = "x", cat = "Loan", responsibleMemberId: number | null = null): SettleTagged => ({
  memberId,
  amount,
  label,
  category: { name: cat, responsibleMemberId },
});

describe("computeSettlement", () => {
  it("net = income owned − (expenses + prev-month spends); routes through the hub", () => {
    const res = computeSettlement({
      members,
      incomes: [
        { ownerId: 1, amount: 80_000 },
        { ownerId: 2, amount: 60_000 },
        { ownerId: 3, amount: 50_000 },
      ],
      expenses: [exp(1, 20_000), exp(2, 10_000)],
      spends: [exp(1, 5_000, "Veg", "Veg")],
      records: [],
      treasurerId: 3,
      prevLabel: "JUN 2026",
    });

    const bala = res.rows.find((r) => r.id === 1)!;
    expect(bala.contributed).toBe(80_000);
    expect(bala.paid).toBe(25_000); // 20k expense + 5k spend
    expect(bala.net).toBe(55_000);

    // treasurer is excluded from transfers; the other two pay the hub
    expect(res.transfers).toHaveLength(2);
    expect(res.transfers.map((t) => `${t.from}->${t.to}:${t.amount}`)).toEqual([
      "Bala->KA:55000",
      "Harish->KA:50000",
    ]);
    // spend label carries the previous month tag
    expect(bala.paidItems.find((p) => p.kind === "spend")?.label).toBe("Veg (JUN 2026)");
  });

  it("a spend on the spender's OWN category is not credited (avoids double-credit)", () => {
    const res = computeSettlement({
      members,
      incomes: [{ ownerId: 1, amount: 80_000 }],
      // Bala holds "Petrol" (responsible = 1). His ₹5k spend there must NOT credit him
      // again; a ₹2k spend on shared "Veg" (responsible = null) still credits him.
      expenses: [],
      spends: [exp(1, 5_000, "fuel", "Petrol", 1), exp(1, 2_000, "veg", "Veg", null)],
      records: [],
      treasurerId: 3,
      prevLabel: "JUN 2026",
    });
    const bala = res.rows.find((r) => r.id === 1)!;
    expect(bala.paid).toBe(2_000); // only the shared-category spend counts
    expect(bala.paidItems.some((p) => p.category === "Petrol")).toBe(false);
  });

  it("negative net → the treasurer pays the member", () => {
    const res = computeSettlement({
      members,
      incomes: [{ ownerId: 2, amount: 10_000 }],
      expenses: [exp(2, 30_000)], // Harish paid more than he earned
      spends: [],
      records: [],
      treasurerId: 3,
      prevLabel: null,
    });
    const t = res.transfers.find((x) => x.fromId === 3 && x.toId === 2);
    expect(t).toBeTruthy();
    expect(t!.amount).toBe(20_000); // KA -> Harish 20,000
  });

  it("sums payment rows; settled only once they cover the net", () => {
    const res = computeSettlement({
      members,
      incomes: [{ ownerId: 1, amount: 80_000 }],
      expenses: [],
      spends: [],
      // Two partial payments (per-payment model) that together cover the 80k owed.
      records: [
        { id: 9, fromMemberId: 1, toMemberId: 3, amount: 30_000, settledAt: new Date(), key: "a" },
        { id: 10, fromMemberId: 1, toMemberId: 3, amount: 50_000, settledAt: new Date(), key: "b" },
      ],
      treasurerId: 3,
      prevLabel: null,
    });
    const t = res.transfers.find((x) => x.fromId === 1 && x.toId === 3)!;
    expect(t.amount).toBe(80_000);
    expect(t.paidAmount).toBe(80_000); // 30k + 50k summed
    expect(t.payments).toHaveLength(2);
    expect(t.settled).toBe(true); // fully covered
    expect(res.allSettled).toBe(true);
  });

  it("treats a part-paid transfer as NOT settled (remainder still owed)", () => {
    const res = computeSettlement({
      members,
      incomes: [{ ownerId: 1, amount: 80_000 }],
      expenses: [],
      spends: [],
      records: [{ id: 9, fromMemberId: 1, toMemberId: 3, amount: 30_000, settledAt: new Date(), key: "a" }],
      treasurerId: 3,
      prevLabel: null,
    });
    const t = res.transfers.find((x) => x.fromId === 1 && x.toId === 3)!;
    expect(t.paidAmount).toBe(30_000);
    expect(t.settled).toBe(false); // 30k of 80k → still owed 50k
    expect(res.allSettled).toBe(false);
  });

  it("no transfers when there is no treasurer", () => {
    const res = computeSettlement({
      members,
      incomes: [{ ownerId: 1, amount: 80_000 }],
      expenses: [],
      spends: [],
      records: [],
      treasurerId: null,
      prevLabel: null,
    });
    expect(res.transfers).toEqual([]);
    expect(res.allSettled).toBe(false);
  });
});
