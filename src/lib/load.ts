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
    // Phase 2: land on the CURRENT calendar month (IST) when it's live. Spends route here by date, so
    // this is where daily life happens; the prior month becomes a finalize-and-close task, reachable
    // via the wind-down reminder + the month picker. Fall back to the earliest still-open month (the
    // pre-Phase-2 "working month", and the brief month-boundary case), then the preview draft.
    const t = new Date(Date.now() + 330 * 60000); // IST = UTC+5:30 — matches spend date-routing
    const cy = t.getUTCFullYear();
    const cm = t.getUTCMonth() + 1;
    const openPeriods = periods.filter((p) => p.status === "open"); // getPeriods is year/month desc
    const currentOpen = periods.find((p) => p.year === cy && p.month === cm && p.status === "open") ?? null;
    const workingOpen = openPeriods[openPeriods.length - 1] ?? null; // last = earliest open
    selected =
      currentOpen ??
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

  // "Provisional" = the selected month is OPEN but an earlier month is still open (not wound down
  // yet). It's a real, editable month, but its carry-forward from the working month isn't final —
  // so we badge it as a preview and offer a "refresh estimate" until that earlier month winds down.
  const earlierOpen =
    selected && selected.status === "open"
      ? periods.find((p) => p.status === "open" && (p.year < selected.year || (p.year === selected.year && p.month < selected.month))) ?? null
      : null;
  const provisional = earlierOpen ? { workingLabel: earlierOpen.label } : null;

  return {
    household,
    windDownReminder,
    previewPeriod,
    provisional,
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
