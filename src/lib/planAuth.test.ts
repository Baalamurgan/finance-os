import { describe, it, expect } from "vitest";
import { canActOnStep, canActInMonth, type PlanActor } from "./planAuth";

// Actors. TREASURER here is a plain member (role-wise) who happens to be the hub — the exact shape of
// the reported bug (Arumugam): not head, not manager, but the treasurer.
const HEAD: PlanActor = { memberId: 1, isHead: true, canEdit: true };
const MANAGER: PlanActor = { memberId: 2, isHead: false, canEdit: true };
const TREASURER: PlanActor = { memberId: 3, isHead: false, canEdit: false };
const MEMBER: PlanActor = { memberId: 4, isHead: false, canEdit: false };
const OTHER: PlanActor = { memberId: 5, isHead: false, canEdit: false };
const treasurerId = 3;

describe("canActOnStep — settlement transfers & advances (head or a party)", () => {
  for (const kind of ["transfer-in", "transfer-out", "advance"] as const) {
    it(`${kind}: head and either party may act; a manager or outsider may not`, () => {
      const facts = { kind, fromId: 4, toId: 5 };
      expect(canActOnStep(facts, HEAD)).toBe(true);
      expect(canActOnStep(facts, MEMBER)).toBe(true); // fromId
      expect(canActOnStep(facts, OTHER)).toBe(true); // toId
      expect(canActOnStep(facts, MANAGER)).toBe(false); // manager isn't a party and isn't head
      expect(canActOnStep(facts, { memberId: 9, isHead: false, canEdit: false })).toBe(false);
    });
  }
});

describe("canActOnStep — manual peer move (head/manager or a party)", () => {
  const facts = { kind: "manual" as const, fromId: 4, toId: 5 };
  it("head, manager, and either party may act; an outsider may not", () => {
    expect(canActOnStep(facts, HEAD)).toBe(true);
    expect(canActOnStep(facts, MANAGER)).toBe(true);
    expect(canActOnStep(facts, MEMBER)).toBe(true);
    expect(canActOnStep(facts, OTHER)).toBe(true);
    expect(canActOnStep(facts, { memberId: 9, isHead: false, canEdit: false })).toBe(false);
  });
});

describe("canActOnStep — income (head/manager or the owner)", () => {
  const facts = { kind: "income" as const, ownerId: 4 };
  it("head, manager, and the owner may act; others may not", () => {
    expect(canActOnStep(facts, HEAD)).toBe(true);
    expect(canActOnStep(facts, MANAGER)).toBe(true);
    expect(canActOnStep(facts, MEMBER)).toBe(true); // owner
    expect(canActOnStep(facts, OTHER)).toBe(false);
  });
});

describe("canActOnStep — pool hand-over (head/manager or the holder)", () => {
  const facts = { kind: "pool-handover" as const, fromId: 4 };
  it("head, manager, and the holder may act; others may not", () => {
    expect(canActOnStep(facts, HEAD)).toBe(true);
    expect(canActOnStep(facts, MANAGER)).toBe(true);
    expect(canActOnStep(facts, MEMBER)).toBe(true); // holder
    expect(canActOnStep(facts, OTHER)).toBe(false);
  });
});

describe("canActOnStep — piggy hand-over (head/manager only)", () => {
  const facts = { kind: "piggy" as const, fromId: 4, toId: 5 };
  it("only head/manager may act — not the parties", () => {
    expect(canActOnStep(facts, HEAD)).toBe(true);
    expect(canActOnStep(facts, MANAGER)).toBe(true);
    expect(canActOnStep(facts, MEMBER)).toBe(false);
  });
});

describe("canActOnStep — ordinary assigned bill (head/manager or the payer)", () => {
  const facts = { kind: "bill" as const, payerId: 4, treasurerId, hubLine: false };
  it("head/manager and the payer may act; a non-payer (incl. treasurer) may not", () => {
    expect(canActOnStep(facts, HEAD)).toBe(true);
    expect(canActOnStep(facts, MANAGER)).toBe(true);
    expect(canActOnStep(facts, MEMBER)).toBe(true); // payer
    expect(canActOnStep(facts, TREASURER)).toBe(false); // not the payer, and not a hub line
    expect(canActOnStep(facts, OTHER)).toBe(false);
  });
});

describe("canActOnStep — hub-disbursed lines (the reported bug + siblings)", () => {
  it("pool-funded misc: treasurer (sender) AND recipient may tick; an outsider may not", () => {
    // Stored against the RECIPIENT (payerId = recipient's id), hub line, treasurer resolves.
    const facts = { kind: "bill" as const, payerId: 4, treasurerId, hubLine: true };
    expect(canActOnStep(facts, TREASURER)).toBe(true); // ← was silently blocked before the fix
    expect(canActOnStep(facts, MEMBER)).toBe(true); // recipient (payerId)
    expect(canActOnStep(facts, OTHER)).toBe(false);
  });

  it("shared / pool bill (no stored member): treasurer may tick; an outsider may not", () => {
    const facts = { kind: "bill" as const, payerId: null, treasurerId, hubLine: true };
    expect(canActOnStep(facts, TREASURER)).toBe(true); // ← latent sibling of the bug
    expect(canActOnStep(facts, OTHER)).toBe(false);
    expect(canActOnStep(facts, HEAD)).toBe(true);
  });

  it("allowance: treasurer (sender / fromId) and recipient (toId) may tick", () => {
    const facts = { kind: "allowance" as const, fromId: treasurerId, toId: 4, treasurerId };
    expect(canActOnStep(facts, TREASURER)).toBe(true); // fromId AND treasurer
    expect(canActOnStep(facts, MEMBER)).toBe(true); // toId (recipient)
    expect(canActOnStep(facts, OTHER)).toBe(false);
  });
});

describe("canActInMonth", () => {
  it("open month: anyone passes", () => {
    expect(canActInMonth(true, false)).toBe(true);
    expect(canActInMonth(true, true)).toBe(true);
  });
  it("closed month: only the head passes", () => {
    expect(canActInMonth(false, true)).toBe(true);
    expect(canActInMonth(false, false)).toBe(false);
  });
});
