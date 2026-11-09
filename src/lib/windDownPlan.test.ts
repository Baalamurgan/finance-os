import { describe, it, expect } from "vitest";
import { planWindDown, type PlanRow, type CutTarget } from "./windDownPlan";

const row = (categoryId: number, name: string, budget: number, spent: number, holderId: number | null = null, planned = false): PlanRow =>
  ({ categoryId, name, budget, spent, holderId, planned });
const tgt = (categoryId: number, name: string, capacity: number): CutTarget => ({ categoryId, name, capacity });

const provision = row(1, "Provision", 5000, 8000, 10);
const nonVeg = row(2, "Non-veg", 3000, 1000, 20);
const targets = [tgt(1, "Provision", 5000), tgt(2, "Non-veg", 3000), tgt(3, "Fuel", 4000)];

describe("planWindDown", () => {
  it("alone: overspend is cut in full, holder paid back; leftover → Piggy", () => {
    const { groups, cutByCat } = planWindDown([provision, nonVeg], targets, []);
    const p = groups.find((g) => g.categoryIds[0] === 1)!;
    expect(p.over).toBe(3000);
    expect(cutByCat.get(1)).toBe(3000);
    expect(p.credits).toEqual([{ holderId: 10, categoryId: 1, name: "Provision", amount: 3000 }]);
    const n = groups.find((g) => g.categoryIds[0] === 2)!;
    expect(n.destination).toBe("piggy");
    expect(n.leftoverTo).toEqual([{ categoryId: 2, amount: 2000 }]);
    expect(n.holds).toEqual([]);
  });

  it("grouped (the 8k/5k + 1k/3k example): only the net 1k is cut, from Provision", () => {
    const { groups, cutByCat } = planWindDown([provision, nonVeg], targets, [{ categoryIds: [1, 2], destination: "piggy", cuts: null }]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.budget).toBe(8000);
    expect(g.spent).toBe(9000);
    expect(g.over).toBe(1000);
    expect(g.covered).toBe(2000);
    expect(cutByCat.get(1)).toBe(1000);
    expect(cutByCat.get(2)).toBeUndefined();
    expect(g.leftoverTo).toEqual([]);
    expect(g.credits[0].amount).toBe(3000); // holder still gets the full overspend back
    expect(g.holds).toEqual([{ holderId: 20, categoryId: 2, name: "Non-veg", amount: 2000 }]);
  });

  it("grouped with money left: no cut, the rest goes to the chosen destination", () => {
    const small = row(1, "Provision", 5000, 6000, 10);
    const { groups, cutByCat } = planWindDown([small, nonVeg], targets, [{ categoryIds: [1, 2], destination: "income", cuts: null }]);
    const g = groups[0];
    expect(g.over).toBe(0);
    expect(g.left).toBe(1000);
    expect(cutByCat.size).toBe(0);
    expect(g.destination).toBe("income");
    expect(g.leftoverTo).toEqual([{ categoryId: 2, amount: 1000 }]);
    expect(g.holds[0].amount).toBe(1000);
  });

  it("several leftovers cover in proportion to their leftover", () => {
    const fuel = row(3, "Fuel", 4000, 3000, 30); // 1000 left
    const { groups } = planWindDown([row(1, "Provision", 5000, 6500, 10), nonVeg, fuel], targets, [{ categoryIds: [1, 2, 3], destination: "piggy", cuts: null }]);
    const g = groups[0];
    expect(g.covered).toBe(1500);
    expect(g.holds.find((h) => h.categoryId === 2)!.amount).toBe(1000); // 2000 of 3000 leftover
    expect(g.holds.find((h) => h.categoryId === 3)!.amount).toBe(500);
    expect(g.leftoverTo.reduce((t, x) => t + x.amount, 0)).toBe(1500);
  });

  it("two overspent: automatic split by how much each went over; edited split is kept", () => {
    const a = row(1, "Provision", 5000, 7000, 10); // +2000
    const b = row(3, "Fuel", 4000, 5000, 30);      // +1000
    const auto = planWindDown([a, b, nonVeg], targets, [{ categoryIds: [1, 3, 2], destination: "piggy", cuts: null }]);
    expect(auto.groups[0].over).toBe(1000);
    expect(auto.cutByCat.get(1)).toBe(666.67);
    expect(auto.cutByCat.get(3)).toBe(333.33);
    const edited = planWindDown([a, b, nonVeg], targets, [{ categoryIds: [1, 3, 2], destination: "piggy", cuts: [{ categoryId: 3, amount: 1000 }] }]);
    expect(edited.cutByCat.get(3)).toBe(1000);
    expect(edited.cutByCat.get(1)).toBeUndefined();
  });

  it("a cut never takes a budget below 0 — the rest spills to the group, then to overflow", () => {
    const huge = row(1, "Provision", 5000, 11000, 10); // +6000, next budget only 5000
    const alone = planWindDown([huge], targets, []);
    expect(alone.cutByCat.get(1)).toBe(5000);
    expect(alone.groups[0].overflow).toBe(1000);
    const grouped = planWindDown([huge, row(3, "Fuel", 4000, 4000, 30)], targets, [{ categoryIds: [1, 3], destination: "piggy", cuts: null }]);
    expect(grouped.cutByCat.get(1)).toBe(5000);
    expect(grouped.cutByCat.get(3)).toBe(1000);
    expect(grouped.overflow).toBe(0);
  });

  it("a planned card's overspend goes on the picked budget; with none it's flagged and overflows", () => {
    const wedding = row(9, "Wedding", 2000, 2500, 10, true);
    const unpicked = planWindDown([wedding], targets, []);
    expect(unpicked.groups[0].needsTarget).toBe(true);
    expect(unpicked.overflow).toBe(500);
    const picked = planWindDown([wedding], targets, [{ categoryIds: [9], destination: "piggy", cuts: [{ categoryId: 1, amount: 500 }] }]);
    expect(picked.cutByCat.get(1)).toBe(500);
    expect(picked.overflow).toBe(0);
    const inGroup = planWindDown([wedding, row(1, "Provision", 5000, 5000, 10)], targets, [{ categoryIds: [9, 1], destination: "piggy", cuts: null }]);
    expect(inGroup.cutByCat.get(1)).toBe(500);
  });

  it("a saved split from older numbers keeps its proportions", () => {
    const a = row(1, "Provision", 5000, 7000, 10); // now +2000 (saved when it was +1000)
    const { cutByCat } = planWindDown([a], targets, [{ categoryIds: [1], destination: "piggy", cuts: [{ categoryId: 1, amount: 600 }, { categoryId: 3, amount: 400 }] }]);
    expect(cutByCat.get(1)).toBe(1200);
    expect(cutByCat.get(3)).toBe(800);
  });

  it("shared (no holder) categories get no settlement lines", () => {
    const { groups } = planWindDown([row(1, "Provision", 5000, 6000, null), row(2, "Non-veg", 3000, 1000, null)], targets, [{ categoryIds: [1, 2], destination: "piggy", cuts: null }]);
    expect(groups[0].credits).toEqual([]);
    expect(groups[0].holds).toEqual([]);
  });
});
