"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { hashPin, lockoutMs, newSalt, pinMatches, pinRejectReason } from "@/lib/applock-core";
import { clearPersonalUnlock, setPersonalUnlock } from "@/lib/personal-lock";

async function currentMember() {
  const session = await auth();
  if (!session?.user) return null;
  const email = session.user.email?.toLowerCase();
  return session.user.memberId
    ? prisma.member.findUnique({ where: { id: session.user.memberId } })
    : email
      ? prisma.member.findFirst({ where: { email } })
      : null;
}

// ── Unlock personal (own PIN, own lockout ladder — no Google escalation) ─────
export type PersonalUnlockState = { ok: boolean; error?: string; lockedMs?: number };

export async function verifyPersonalPin(
  _prev: PersonalUnlockState,
  formData: FormData,
): Promise<PersonalUnlockState> {
  const member = await currentMember();
  if (!member) return { ok: false, error: "Signed out." };
  if (!member.personalPinHash || !member.personalPinSalt) {
    await setPersonalUnlock(member.id);
    redirect("/personal/expenses");
  }

  const now = Date.now();
  if (member.personalPinLockedUntil && member.personalPinLockedUntil.getTime() > now) {
    return { ok: false, lockedMs: member.personalPinLockedUntil.getTime() - now, error: "Too many tries." };
  }

  const pin = String(formData.get("pin") ?? "");
  if (pinMatches(pin, member.personalPinSalt, member.personalPinHash)) {
    await prisma.member.update({
      where: { id: member.id },
      data: { personalPinFailedAttempts: 0, personalPinLockedUntil: null },
    });
    await setPersonalUnlock(member.id);
    // Redirect from the server so the unlock cookie + navigation are one atomic
    // response (fixes the intermittent "enter PIN twice" on the phone PWA — the
    // old client-effect nav raced the post-action re-render and re-fired submit).
    redirect("/personal/expenses");
  }

  const attempts = member.personalPinFailedAttempts + 1;
  const ms = lockoutMs(attempts);
  await prisma.member.update({
    where: { id: member.id },
    data: { personalPinFailedAttempts: attempts, personalPinLockedUntil: ms ? new Date(now + ms) : null },
  });
  return {
    ok: false,
    error: ms ? "Too many tries. Please wait a moment." : "That PIN wasn't right.",
    lockedMs: ms || undefined,
  };
}

// ── Set / change the personal PIN (onboarding + Setup) ───────────────────────
export type PersonalPinAdminState = { ok: boolean; error?: string };

export async function setPersonalPin(
  _prev: PersonalPinAdminState,
  formData: FormData,
): Promise<PersonalPinAdminState> {
  const member = await currentMember();
  if (!member) return { ok: false, error: "Signed out." };
  const pin = String(formData.get("pin") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const reason = pinRejectReason(pin);
  if (reason) return { ok: false, error: reason };
  if (pin !== confirm) return { ok: false, error: "The two PINs don't match." };

  const salt = newSalt();
  await prisma.member.update({
    where: { id: member.id },
    data: {
      personalPinHash: hashPin(pin, salt),
      personalPinSalt: salt,
      personalPinFailedAttempts: 0,
      personalPinLockedUntil: null,
    },
  });
  await setPersonalUnlock(member.id); // keep them unlocked after setting
  revalidatePath("/personal", "layout");
  return { ok: true };
}

// Switch back to the Family app — clears the personal unlock so re-entry re-asks.
export async function exitToFamily(): Promise<void> {
  await clearPersonalUnlock();
  // Switching back to Family makes it the remembered view, so the next launch (and
  // this redirect to "/") lands on Family instead of bouncing back to Personal.
  (await cookies()).set("last-view", "family", { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  redirect("/");
}

export async function removePersonalBiometric(): Promise<void> {
  const member = await currentMember();
  if (!member) return;
  await prisma.webAuthnCredential.deleteMany({ where: { memberId: member.id, purpose: "personal" } });
  revalidatePath("/personal", "layout");
}
