import crypto from "node:crypto";
import { cookies } from "next/headers";

// ── App-lock: one shared household PIN, entered after Google login ──────────
// This is a *convenience/privacy* lock on top of Google auth: it stops casual
// access on an already-signed-in device. It is not encryption of your data.

export const APPLOCK_COOKIE = "applock";
export const PIN_LENGTH = 4;
export const MAX_ATTEMPTS_BEFORE_RELOGIN = 10;

const SECRET = process.env.AUTH_SECRET ?? "dev-insecure-secret";

/** A fresh per-household salt (hex). */
export function newSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** PBKDF2-SHA256 hash of a PIN. Slow-ish + salted; brute-force defence is the
 *  lockout ladder (the PIN space is tiny by nature). */
export function hashPin(pin: string, saltHex: string): string {
  const salt = Buffer.from(saltHex, "hex");
  return crypto.pbkdf2Sync(pin, salt, 120_000, 32, "sha256").toString("hex");
}

/** Constant-time compare of two hex strings. */
export function pinMatches(pin: string, saltHex: string, hash: string): boolean {
  const candidate = hashPin(pin, saltHex);
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Reject easily-guessed PINs (all-same, sequential, and a few classics). */
export function pinRejectReason(pin: string): string | null {
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) return `Use ${PIN_LENGTH} digits.`;
  if (/^(\d)\1+$/.test(pin)) return "Too easy — avoid repeating the same digit.";
  if ("0123456789".includes(pin) || "9876543210".includes(pin))
    return "Too easy — avoid a straight sequence.";
  if (["2580", "1379", "0852"].includes(pin)) return "Too easy — avoid keypad patterns.";
  return null;
}

// ── Signed unlock cookie (session cookie → clears on cold start) ────────────

/** Sign an unlock token bound to the household. */
export function signUnlock(householdId: number): string {
  const payload = Buffer.from(JSON.stringify({ hh: householdId, iat: Date.now() })).toString(
    "base64url",
  );
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** Verify an unlock token is untampered and for this household. */
export function verifyUnlock(token: string | undefined, householdId: number): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.hh === householdId;
  } catch {
    return false;
  }
}

/** Set the unlock cookie (session cookie → clears when the app is fully closed,
 *  giving the "cold start only" re-lock behaviour). */
export async function setUnlockCookie(householdId: number) {
  const jar = await cookies();
  jar.set(APPLOCK_COOKIE, signUnlock(householdId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // no maxAge / expires → a session cookie
  });
}

export async function clearUnlockCookie() {
  (await cookies()).delete(APPLOCK_COOKIE);
}

/** Is the current request already unlocked for this household? */
export async function isUnlocked(householdId: number): Promise<boolean> {
  const token = (await cookies()).get(APPLOCK_COOKIE)?.value;
  return verifyUnlock(token, householdId);
}

// ── Lockout ladder ──────────────────────────────────────────────────────────

/** Milliseconds to lock out after N consecutive wrong PINs. No penalty for the
 *  first 4; then 30s doubling, capped at 15 min; at MAX we force Google re-login. */
export function lockoutMs(attempts: number): number {
  if (attempts < 5) return 0;
  const step = attempts - 4; // 1, 2, 3, …
  return Math.min(30_000 * 2 ** (step - 1), 15 * 60_000);
}

// ── WebAuthn relying-party config (derived from the deployment URL) ─────────

export function rpConfig() {
  const raw =
    process.env.APP_LOCK_ORIGIN ??
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000";
  const u = new URL(raw);
  return { rpID: u.hostname, origin: u.origin, rpName: "Family Finance OS" };
}
