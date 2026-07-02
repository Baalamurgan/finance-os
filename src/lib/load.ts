import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isUnlocked } from "@/lib/applock";
import {
  getCategories,
  getHousehold,
  getMembers,
  getPeriods,
  getPiggyBalance,
} from "@/lib/queries";

export type Common = NonNullable<Awaited<ReturnType<typeof loadCommon>>>;

/**
 * Shared data every screen needs. Period is resolved by month/year (?y=&m=);
 * the current member comes from the Auth.js session (by email/memberId).
 * Returns null when nothing is seeded.
 */
export async function loadCommon(params?: { y?: string; m?: string }) {
  const household = await getHousehold();
  if (!household) return null;

  const [periods, members, categories, piggyBalance, session] = await Promise.all([
    getPeriods(household.id),
    getMembers(household.id),
    getCategories(household.id),
    getPiggyBalance(household.id),
    auth(),
  ]);

  // authoritative auth check (proxy is only an optimistic redirect)
  if (!session?.user) redirect("/signin");

  const email = session.user.email?.toLowerCase();
  const currentMember =
    members.find((m) => m.id === session.user.memberId) ??
    members.find((m) => m.email?.toLowerCase() === email) ??
    null;

  // signed in but not mapped to any family member → deny
  if (!currentMember) redirect("/signin?error=AccessDenied");

  // App-lock: if the household has a shared PIN and this device isn't unlocked
  // for the session, gate everything behind the lock screen. (The /lock page
  // does its own minimal loading so it never trips this redirect.)
  if (household.pinHash && !(await isUnlocked(household.id))) redirect("/lock");

  // resolve the selected period by (year, month), else latest
  const y = params?.y ? Number(params.y) : undefined;
  const m = params?.m ? Number(params.m) : undefined;

  let selected = null as (typeof periods)[number] | null;
  if (y && m) {
    selected = periods.find((p) => p.year === y && p.month === m) ?? null;
  } else {
    // Prefer TODAY's calendar month if it's OPEN, else the latest open month
    // (so an old closed/imported current month doesn't hide the Add buttons),
    // else just the latest period. periods are sorted newest-first.
    const t = new Date();
    selected =
      periods.find(
        (p) => p.year === t.getFullYear() && p.month === t.getMonth() + 1 && p.status === "open",
      ) ??
      periods.find((p) => p.status === "open") ??
      periods[0] ??
      null;
  }

  const now = new Date();
  const selYear = y ?? selected?.year ?? now.getFullYear();
  const selMonth = m ?? selected?.month ?? now.getMonth() + 1;
  const noData = !selected;

  // App-lock state for the header menu (enable biometric / lock now).
  const pinEnabled = !!household.pinHash;
  const hasBiometric =
    pinEnabled && (await prisma.webAuthnCredential.count({ where: { memberId: currentMember.id } })) > 0;

  // In-app wind-down reminder: if the head set a close day, surface a banner
  // in the 5 days leading up to it (counts to this month's day, else next month's).
  let windDownReminder: { daysUntil: number; day: number } | null = null;
  const wd = household.windDownDay;
  if (wd && wd >= 1 && wd <= 31) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let close = new Date(today.getFullYear(), today.getMonth(), wd);
    if (close.getTime() < today.getTime()) {
      close = new Date(today.getFullYear(), today.getMonth() + 1, wd);
    }
    const daysUntil = Math.round((close.getTime() - today.getTime()) / 86400000);
    if (daysUntil <= 5) windDownReminder = { daysUntil, day: wd };
  }

  return {
    household,
    windDownReminder,
    periods,
    selected,
    selYear,
    selMonth,
    noData,
    members,
    categories,
    piggyBalance,
    currentMember,
    pinEnabled,
    hasBiometric,
    isHead: currentMember?.role === "head",
    // Head + Manager may edit income/expenses; Members are read-only.
    canEdit: currentMember?.role === "head" || currentMember?.role === "manager",
    role: currentMember?.role ?? "member",
    account: {
      name: session.user.name ?? currentMember.name,
      email: session.user.email ?? currentMember.email ?? "",
      image: session.user.image ?? null,
    },
  };
}
