import { cookies } from "next/headers";

// Short-lived, httpOnly cookies that carry the WebAuthn challenge between the
// "options" and "verify" round-trips (registration + authentication).
export const REG_CHALLENGE = "wa-reg-chal";
export const AUTH_CHALLENGE = "wa-auth-chal";

export async function setChallenge(name: string, value: string) {
  (await cookies()).set(name, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 300, // 5 minutes to complete the ceremony
  });
}

export async function getChallenge(name: string): Promise<string | undefined> {
  return (await cookies()).get(name)?.value;
}

export async function clearChallenge(name: string) {
  (await cookies()).delete(name);
}
