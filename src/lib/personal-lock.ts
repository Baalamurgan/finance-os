import { cookies } from "next/headers";
import { signScope, verifyScope } from "@/lib/applock-core";

// Personal-lock cookie — completely separate from the family `applock` cookie and
// bound to the member id. Session cookie (cleared on app close); also cleared
// whenever the user switches back to Family, so a handed-over phone can't reach
// personal. No client-side auto-lock timers (that caused the family lock's loop).
export const PERSONAL_COOKIE = "personal-unlock";
const SCOPE = "personal";

export async function setPersonalUnlock(memberId: number) {
  const jar = await cookies();
  jar.set(PERSONAL_COOKIE, signScope(SCOPE, memberId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function clearPersonalUnlock() {
  (await cookies()).delete(PERSONAL_COOKIE);
}

export async function isPersonalUnlocked(memberId: number): Promise<boolean> {
  const token = (await cookies()).get(PERSONAL_COOKIE)?.value;
  return verifyScope(token, SCOPE, memberId);
}
