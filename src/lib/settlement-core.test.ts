import { describe, it, expect } from "vitest";
import { computeSettlement, type SettleTagged } from "@/lib/settlement-core";

const members = [
  { id: 1, name: "Bala" },
  { id: 2, name: "Harish" },
  { id: 3, name: "KA" }, // treasurer/hub
];
const exp = (
  memberId: number | null,
  amount: number,
  label = "x",
  cat = "Loan",
  responsibleMemberId: number | null = null,
): SettleTagged => ({
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

  it("a spend on your OWN category does not credit you (already covered by its monthly line)", () => {
    const res = computeSettlement({
      members,
      incomes: [{ ownerId: 1, amount: 80_000 }],
      expenses: [],
      spends: [
        exp(1, 500, "Recharge", "Mobile", 1), // Bala's own category → NOT credited
        exp(1, 2_000, "Veg", "Misc", null), // shared → credited
        exp(1, 1_500, "Fuel", "Car", 2), // Harish's category → credited
      ],
      records: [],
      treasurerId: 3,
      prevLabel: "JUN 2026",
    });
    const bala = res.rows.find((r) => r.id === 1)!;
    expect(bala.paid).toBe(3_500); // 2_000 + 1_500, the 500 own-category spend excluded
    expect(bala.paidItems.some((p) => p.label.startsWith("Recharge"))).toBe(false);
    expect(bala.net).toBe(76_500);
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

  it("marks settled transfers and flags amount drift", () => {
    const res = computeSettlement({
      members,
      incomes: [{ ownerId: 1, amount: 80_000 }],
      expenses: [],
      spends: [],
      records: [{ id: 9, fromMemberId: 1, toMemberId: 3, amount: 70_000, settledAt: new Date() }],
      treasurerId: 3,
      prevLabel: null,
    });
    const t = res.transfers.find((x) => x.fromId === 1 && x.toId === 3)!;
    expect(t.amount).toBe(80_000);
    expect(t.settled).toBe(true);
    expect(t.amountChanged).toBe(true); // recorded 70k ≠ current 80k
    expect(res.settledCount).toBe(1);
    expect(res.allSettled).toBe(true);
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
