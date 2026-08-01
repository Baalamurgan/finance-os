import { redirect } from "next/navigation";
import { cookies } from "next/headers";
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
    // Land on the WORKING month — the EARLIEST still-open month (wind-down closes the oldest open
    // month first, so that's the one the family is still living in and logging into). During the
    // wind-down window the calendar rolls to Aug 1 but July stays the working month until it winds
    // down on the 5th, so daily spends/bills default to July — NOT the August calendar month, even
    // if August is (prematurely) open. The next-month PREVIEW draft is the default only when
    // nothing is open, and is always reachable via the month picker.
    const t = new Date();
    const cy = t.getFullYear();
    const cm = t.getMonth() + 1;
    const openPeriods = periods.filter((p) => p.status === "open"); // getPeriods is year/month desc
    const workingOpen = openPeriods[openPeriods.length - 1] ?? null; // last = earliest open
    selected =
      workingOpen ??
      periods.find((p) => p.year === cy && p.month === cm && p.status === "draft") ??
      periods[0] ??
      null;
  }

  const now = new Date();
  const selYear = y ?? selected?.year ?? now.getFullYear();
  const selMonth = m ?? selected?.month ?? now.getMonth() + 1;
  const noData = !selected;

  // Settlement lock: once ANY transfer for this month is marked paid, money has started
  // moving to the treasurer against the shown numbers — so the sheet's planned expense/income
  // is frozen for non-heads (daily spends still flow; the head can still edit). See the Sheet.
  const locked =
    selected != null &&
    (await prisma.settlementRecord.count({ where: { periodId: selected.id } })) > 0;

  // App-lock state for the header menu (enable biometric / lock now).
  const pinEnabled = !!household.pinHash;
  const hasBiometric =
    pinEnabled && (await prisma.webAuthnCredential.count({ where: { memberId: currentMember.id } })) > 0;

  // "View as member": a head can downgrade themselves to read-only (effective role).
  const actualRole = currentMember?.role ?? "member";
  const actualIsHead = actualRole === "head";
  const viewingAsMember =
    actualIsHead && (await cookies()).get("view-as")?.value === "member";
  const role = viewingAsMember ? "member" : actualRole;

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

  // Next-month preview draft, if one exists — surfaced in the month dropdown so ANY
  // member can jump to it (not just via the head's preview button).
  const draft = periods.find((p) => p.status === "draft") ?? null;
  const previewPeriod = draft ? { year: draft.year, month: draft.month, label: draft.label } : null;

  return {
    household,
    windDownReminder,
    previewPeriod,
    periods,
    selected,
    selYear,
    selMonth,
    noData,
    locked,
    members,
    categories,
    piggyBalance,
    currentMember,
    pinEnabled,
    hasBiometric,
    actualIsHead,
    viewingAsMember,
    // Effective role (honours "view as member"): Head + Manager may edit; Members read-only.
    isHead: role === "head",
    canEdit: role === "head" || role === "manager",
    role,
    account: {
      name: session.user.name ?? currentMember.name,
      email: session.user.email ?? currentMember.email ?? "",
      image: session.user.image ?? null,
    },
  };
}
