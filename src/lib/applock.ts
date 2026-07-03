import { cookies } from "next/headers";
import { APPLOCK_COOKIE, signUnlock, verifyUnlock } from "@/lib/applock-core";

// Request-scoped app-lock helpers (use next/headers). The pure primitives live
// in applock-core.ts (unit-tested); re-exported here for existing importers.
export * from "@/lib/applock-core";

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
