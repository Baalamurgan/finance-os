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

  it("owner-charge OFF (default): others' spend on your category does NOT charge you — the hub absorbs it", () => {
    const res = computeSettlement({
      members,
      incomes: [{ ownerId: 1, amount: 80_000 }, { ownerId: 2, amount: 60_000 }],
      expenses: [],
      spends: [exp(2, 600, "fuel", "Petrol", 1)], // Harish spends ₹600 on Bala's own Petrol budget
      records: [],
      treasurerId: 3,
      prevLabel: "OCT 2026",
    });
    const bala = res.rows.find((r) => r.id === 1)!;
    const harish = res.rows.find((r) => r.id === 2)!;
    expect(harish.net).toBe(60_000 - 600); // spender credited
    expect(bala.net).toBe(80_000); // owner NOT charged
    expect(bala.paidItems.some((p) => p.kind === "charge")).toBe(false);
    // Σ net = Σ contributed − 600 → the missing 600 is the leak the hub absorbs
    expect(res.rows.reduce((s, r) => s + r.net, 0)).toBe(139_400);
  });

  it("owner-charge ON: the owner is charged for others' spend on their category (mirror of the credit); balanced", () => {
    const res = computeSettlement({
      members,
      incomes: [{ ownerId: 1, amount: 80_000 }, { ownerId: 2, amount: 60_000 }],
      expenses: [],
      spends: [exp(2, 600, "fuel", "Petrol", 1)],
      records: [],
      treasurerId: 3,
      prevLabel: "OCT 2026",
      applyOwnerCharge: true,
    });
    const bala = res.rows.find((r) => r.id === 1)!;
    const harish = res.rows.find((r) => r.id === 2)!;
    expect(harish.net).toBe(60_000 - 600); // spender still credited ₹600
    expect(bala.net).toBe(80_600); // owner now charged ₹600 → net rises
    expect(bala.paidItems.some((p) => p.kind === "charge" && p.amount === -600)).toBe(true);
    // balanced: the ₹600 Bala owes exactly covers the ₹600 Harish is owed — no hub leak
    expect(res.rows.reduce((s, r) => s + r.net, 0)).toBe(140_000);
  });

  it("owner-charge never applies to the TREASURER's own budget (it already nets for the hub)", () => {
    const res = computeSettlement({
      members,
      incomes: [{ ownerId: 1, amount: 80_000 }, { ownerId: 3, amount: 50_000 }],
      expenses: [],
      spends: [exp(1, 800, "x", "KA Provision", 3)], // Bala spends ₹800 on KA's (treasurer) OWN category
      records: [],
      treasurerId: 3,
      prevLabel: "OCT 2026",
      applyOwnerCharge: true,
    });
    const ka = res.rows.find((r) => r.id === 3)!; // treasurer/hub
    expect(ka.paidItems.some((p) => p.kind === "charge")).toBe(false); // NOT charged for his own budget
    expect(ka.net).toBe(50_000); // unchanged
    const bala = res.rows.find((r) => r.id === 1)!; // spender is still credited either way
    expect(bala.net).toBe(80_000 - 800);
  });

  it("owner-charge only fires on OTHERS' spend, never your own spend on your own category", () => {
    const res = computeSettlement({
      members,
      incomes: [{ ownerId: 1, amount: 80_000 }],
      expenses: [],
      spends: [exp(1, 5_000, "fuel", "Petrol", 1)], // Bala's OWN spend on his OWN Petrol
      records: [],
      treasurerId: 3,
      prevLabel: "OCT 2026",
      applyOwnerCharge: true,
    });
    const bala = res.rows.find((r) => r.id === 1)!;
    expect(bala.net).toBe(80_000); // not charged for his own spend, not credited either
    expect(bala.paidItems.some((p) => p.kind === "charge")).toBe(false);
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
