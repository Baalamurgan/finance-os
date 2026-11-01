import { describe, it, expect } from "vitest";
import { piggyHeldParts } from "./piggyHeld";

describe("piggyHeldParts", () => {
  it("owner with a pending hand-over lists the leftover once (Arumugam ₹3,310)", () => {
    const r = piggyHeldParts({ swept: 3310, pendingPiggyHeld: 3310, isHolder: false, piggyGone: false });
    expect(r.carriedFreeHeld).toBe(0); // shown only as "Piggy to hand over"
    expect(r.sweptOut).toBe(false); // still inside the opening carry
  });
  it("owner whose swept exceeds the pending slice keeps the difference on the carried line", () => {
    expect(piggyHeldParts({ swept: 3500, pendingPiggyHeld: 3310, isHolder: false, piggyGone: false }).carriedFreeHeld).toBe(190);
  });
  it("owner with no pending slice still lists the carried leftover", () => {
    expect(piggyHeldParts({ swept: 500, pendingPiggyHeld: 0, isHolder: false, piggyGone: false }).carriedFreeHeld).toBe(500);
  });
  it("holder: own slice lives in the General Piggy line, so no carried line and it leaves the carry (Baala ₹12)", () => {
    const r = piggyHeldParts({ swept: 12, pendingPiggyHeld: 0, isHolder: true, piggyGone: false });
    expect(r).toEqual({ sweptOut: true, carriedFreeHeld: 0 });
  });
  it("handed over: nothing listed, leftover has left", () => {
    expect(piggyHeldParts({ swept: 3310, pendingPiggyHeld: 0, isHolder: false, piggyGone: true })).toEqual({ sweptOut: true, carriedFreeHeld: 0 });
  });
});

import { splitPiggyLump } from "./piggyHeld";

describe("splitPiggyLump — Piggy taken as income against a pending hand-over", () => {
  const slices = new Map([[1, 3310]]); // Arumugam holds last month's ₹3,310 leftover

  it("the reported case: the whole lump was withdrawn as income → owner hands it to the treasurer, holder owed nothing", () => {
    const r = splitPiggyLump({ slices, handedOver: false, piggyBalance: 0, incomeAll: 3310, incomeOpen: 3310 });
    expect(r.lumpToHolder).toBe(0); // holder's General Piggy = 0 − 0, not −3,310
    expect(r.toPool.get(1)).toBe(3310);
    expect(r.held.get(1)).toBe(3310); // Arumugam still physically holds it until he gives it to the treasurer
    expect(r.consumed).toBe(3310);
  });
  it("no withdrawal → unchanged: the whole lump is still owed to the holder", () => {
    const r = splitPiggyLump({ slices, handedOver: false, piggyBalance: 3310, incomeAll: 0, incomeOpen: 0 });
    expect(r.lumpToHolder).toBe(3310);
    expect(r.toPool.size).toBe(0);
    expect(r.held.get(1)).toBe(3310);
  });
  it("a withdrawal the holder's own cash covers leaves the lump alone", () => {
    // holder held 5,000 + lump 3,310 = 8,310; took 3,000 as income → balance 5,310 still backs the lump
    const r = splitPiggyLump({ slices, handedOver: false, piggyBalance: 5310, incomeAll: 3000, incomeOpen: 3000 });
    expect(r.lumpToHolder).toBe(3310);
    expect(r.consumed).toBe(0);
  });
  it("a withdrawal bigger than the holder's own cash eats into the lump by exactly the excess", () => {
    // 8,310 − 6,000 = 2,310 left: backs only 2,310 of the 3,310 lump → 1,000 consumed
    const r = splitPiggyLump({ slices, handedOver: false, piggyBalance: 2310, incomeAll: 6000, incomeOpen: 6000 });
    expect(r.consumed).toBe(1000);
    expect(r.lumpToHolder).toBe(2310);
    expect(r.toPool.get(1)).toBe(1000);
  });
  it("once the treasurer has received the batch, the owner no longer holds the consumed part", () => {
    const r = splitPiggyLump({ slices, handedOver: false, piggyBalance: 0, incomeAll: 3310, incomeOpen: 0 });
    expect(r.consumed).toBe(3310);
    expect(r.toPool.size).toBe(0);
    expect(r.held.size).toBe(0);
    expect(r.lumpToHolder).toBe(0);
  });
  it("already handed to the holder → nothing pending, regardless of withdrawals", () => {
    const r = splitPiggyLump({ slices, handedOver: true, piggyBalance: 0, incomeAll: 3310, incomeOpen: 3310 });
    expect(r.lumpToHolder).toBe(0);
    expect(r.consumed).toBe(0);
    expect(r.held.size).toBe(0);
  });
  it("splits the consumed part across owners in proportion to their slices", () => {
    const two = new Map([[1, 3000], [2, 1000]]);
    const r = splitPiggyLump({ slices: two, handedOver: false, piggyBalance: 0, incomeAll: 2000, incomeOpen: 2000 });
    expect(r.toPool.get(1)).toBe(1500);
    expect(r.toPool.get(2)).toBe(500);
    expect(r.toHolder.get(1)).toBe(1500);
    expect(r.toHolder.get(2)).toBe(500);
  });
});
