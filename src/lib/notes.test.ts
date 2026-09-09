import { describe, it, expect } from "vitest";
import { isPoolNote, POOL_NOTE, POOL_BILL_NOTE, CARRY_NOTE, REMOVED_NOTE } from "./notes";

// Guards the exact regression that blocked the treasurer from marking a two-step (__poolbill__)
// disbursement sent: any "is this a pool line?" check must cover BOTH pool variants, not just __pool__.
describe("isPoolNote", () => {
  it("is true for BOTH pool variants", () => {
    expect(isPoolNote(POOL_NOTE)).toBe(true);
    expect(isPoolNote(POOL_BILL_NOTE)).toBe(true); // ← the one that was missed
  });
  it("is false for non-pool notes and null/undefined", () => {
    expect(isPoolNote(null)).toBe(false);
    expect(isPoolNote(undefined)).toBe(false);
    expect(isPoolNote(CARRY_NOTE)).toBe(false);
    expect(isPoolNote(REMOVED_NOTE)).toBe(false);
    expect(isPoolNote("")).toBe(false);
  });
});
