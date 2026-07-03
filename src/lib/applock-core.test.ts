import { describe, it, expect } from "vitest";
import {
  hashPin,
  pinMatches,
  pinRejectReason,
  lockoutMs,
  signUnlock,
  verifyUnlock,
  newSalt,
} from "@/lib/applock-core";

describe("pinRejectReason", () => {
  it("accepts a reasonable 4-digit PIN", () => {
    expect(pinRejectReason("2471")).toBeNull();
    expect(pinRejectReason("9042")).toBeNull();
  });
  it("rejects wrong length / non-digits", () => {
    expect(pinRejectReason("123")).toBeTruthy();
    expect(pinRejectReason("12345")).toBeTruthy();
    expect(pinRejectReason("12a4")).toBeTruthy();
  });
  it("rejects all-same and sequences", () => {
    expect(pinRejectReason("0000")).toBeTruthy();
    expect(pinRejectReason("1111")).toBeTruthy();
    expect(pinRejectReason("1234")).toBeTruthy();
    expect(pinRejectReason("4321")).toBeTruthy();
  });
  it("rejects known keypad patterns", () => {
    expect(pinRejectReason("2580")).toBeTruthy();
  });
});

describe("hashPin / pinMatches", () => {
  it("verifies the correct PIN and rejects wrong ones", () => {
    const salt = newSalt();
    const hash = hashPin("2471", salt);
    expect(pinMatches("2471", salt, hash)).toBe(true);
    expect(pinMatches("2470", salt, hash)).toBe(false);
  });
  it("is salted — same PIN, different salt → different hash", () => {
    expect(hashPin("2471", newSalt())).not.toBe(hashPin("2471", newSalt()));
  });
});

describe("lockoutMs ladder", () => {
  it("no penalty for the first four attempts", () => {
    expect(lockoutMs(1)).toBe(0);
    expect(lockoutMs(4)).toBe(0);
  });
  it("starts at 30s on the fifth and doubles", () => {
    expect(lockoutMs(5)).toBe(30_000);
    expect(lockoutMs(6)).toBe(60_000);
    expect(lockoutMs(7)).toBe(120_000);
  });
  it("caps at 15 minutes", () => {
    expect(lockoutMs(50)).toBe(15 * 60_000);
  });
});

describe("signUnlock / verifyUnlock", () => {
  it("verifies a token for the same household", () => {
    const t = signUnlock(1);
    expect(verifyUnlock(t, 1)).toBe(true);
  });
  it("rejects a token for a different household", () => {
    expect(verifyUnlock(signUnlock(1), 2)).toBe(false);
  });
  it("rejects tampering and garbage", () => {
    const t = signUnlock(1);
    expect(verifyUnlock(t + "x", 1)).toBe(false);
    expect(verifyUnlock("not.a.token", 1)).toBe(false);
    expect(verifyUnlock(undefined, 1)).toBe(false);
  });
});
