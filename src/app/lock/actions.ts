"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth, signOut } from "@/auth";
import {
  MAX_ATTEMPTS_BEFORE_RELOGIN,
  clearUnlockCookie,
  hashPin,
  lockoutMs,
  newSalt,
  pinMatches,
  pinRejectReason,
  setUnlockCookie,
} from "@/lib/applock";

// Manually re-lock this device (clears the unlock cookie → back to the PIN).
export async function lockNow(): Promise<void> {
  await clearUnlockCookie();
  redirect("/lock");
}

async function isHead() {
  const session = await auth();
  return session?.user?.role === "head";
}

// ── Unlock (any signed-in member enters the shared PIN) ─────────────────────

export type UnlockState = {
  ok: boolean;
  error?: string;
  lockedMs?: number; // >0 → temporarily locked out
  relogin?: boolean; // too many attempts → bounce to Google
};

export async function verifyPin(_prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const session = await auth();
  if (!session?.user) return { ok: false, relogin: true, error: "Signed out. Please sign in." };

  const household = await prisma.household.findFirst();
  if (!household) return { ok: false, error: "No household found." };

  // no PIN configured → nothing to unlock, let them through
  if (!household.pinHash || !household.pinSalt) {
    await setUnlockCookie(household.id);
    return { ok: true };
  }

  const now = Date.now();
  if (household.pinLockedUntil && household.pinLockedUntil.getTime() > now) {
    return {
      ok: false,
      lockedMs: household.pinLockedUntil.getTime() - now,
      error: "Too many tries. Please wait a moment.",
    };
  }

  const pin = String(formData.get("pin") ?? "");

  if (pinMatches(pin, household.pinSalt, household.pinHash)) {
    await prisma.household.update({
      where: { id: household.id },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });
    await setUnlockCookie(household.id);
    return { ok: true };
  }

  // wrong PIN → advance the brute-force ladder
  const attempts = household.pinFailedAttempts + 1;

  if (attempts >= MAX_ATTEMPTS_BEFORE_RELOGIN) {
    await prisma.household.update({
      where: { id: household.id },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });
    // escalate: force a fresh Google login (redirects away)
    await signOut({ redirectTo: "/signin?error=TooManyPin" });
    return { ok: false, relogin: true };
  }

  const ms = lockoutMs(attempts);
  await prisma.household.update({
    where: { id: household.id },
    data: { pinFailedAttempts: attempts, pinLockedUntil: ms ? new Date(now + ms) : null },
  });
  return {
    ok: false,
    error: ms ? "Too many tries. Please wait a moment." : "That PIN wasn't right.",
    lockedMs: ms || undefined,
  };
}

// ── Admin (head sets / changes / disables the shared PIN) ────────────────────

export type PinAdminState = { ok: boolean; error?: string; done?: "set" | "disabled" };

export async function setHouseholdPin(
  _prev: PinAdminState,
  formData: FormData,
): Promise<PinAdminState> {
  if (!(await isHead())) return { ok: false, error: "Only the head can change the PIN." };

  const pin = String(formData.get("pin") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const reason = pinRejectReason(pin);
  if (reason) return { ok: false, error: reason };
  if (pin !== confirm) return { ok: false, error: "The two PINs don't match." };

  const household = await prisma.household.findFirst();
  if (!household) return { ok: false, error: "No household found." };

  const salt = newSalt();
  await prisma.household.update({
    where: { id: household.id },
    data: {
      pinHash: hashPin(pin, salt),
      pinSalt: salt,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    },
  });
  // keep whoever just set it unlocked on this device
  await setUnlockCookie(household.id);
  revalidatePath("/", "layout");
  return { ok: true, done: "set" };
}

// Any member may remove their own device biometrics (falls back to PIN).
export async function removeMyBiometric(): Promise<void> {
  const session = await auth();
  const memberId = session?.user?.memberId;
  if (!memberId) return;
  await prisma.webAuthnCredential.deleteMany({ where: { memberId } });
  revalidatePath("/", "layout");
}

export async function disableHouseholdPin(): Promise<void> {
  if (!(await isHead())) return;
  const household = await prisma.household.findFirst();
  if (!household) return;
  await prisma.household.update({
    where: { id: household.id },
    data: { pinHash: null, pinSalt: null, pinFailedAttempts: 0, pinLockedUntil: null },
  });
  revalidatePath("/", "layout");
}
