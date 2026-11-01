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
