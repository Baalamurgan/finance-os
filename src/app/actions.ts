"use server";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { revalidateFamily } from "@/lib/revalidate";
import { redirect, unstable_rethrow } from "next/navigation";
import { cookies, headers } from "next/headers";
import { auth, signOut } from "@/auth";
import { isUnlocked } from "@/lib/applock";
import { log } from "@/lib/log";
import { formatINR, parseAmount } from "@/lib/format";
import { generateMonth } from "@/lib/periodClone";
import { isMiscBucket, MISC_SUBCATEGORIES } from "@/lib/misc";
import { isLearnable, validateSpendLabel } from "@/lib/spendCategorize";
import { getSpendShortcuts, getMatcherKeywords, getFrequentSpendItems, getMoneyPlan, getMiscSubCategories, getFamilyCards } from "@/lib/queries";
import { getCardDues } from "@/lib/personal/cash";
import { ensurePersonalMonth } from "@/lib/personal";
import { planBillMonth, type FundingStyle } from "@/lib/schedule";
import { getBillReminders } from "@/lib/billReminders";
import { applyBudgetShortfall, windDownPeriod } from "@/lib/windDown";
import { SURPLUS_NOTE, CARRY_NOTE, DEFERRED_NOTE, PIGGY_INCOME_NOTE, POOL_NOTE, POOL_BILL_NOTE, REMOVED_NOTE, isPoolNote } from "@/lib/notes";
import { canActOnStep } from "@/lib/planAuth";

// Record a money-affecting change (who + what + when) for the activity feeds: the Money-Plan
// activity (In-Hand) and the Spend activity (Spends tab), both visible to everyone.
async function logActivity(
  entity: string,
  action: "created" | "updated" | "deleted",
  summary: string,
  periodId?: number | null,
) {
  const session = await auth();
  const household = await prisma.household.findFirst({ select: { id: true } });
  if (!household) return;
  await prisma.activityLog.create({
    data: {
      householdId: household.id,
      memberId: session?.user?.memberId ?? null,
      memberName: session?.user?.memberName ?? session?.user?.name ?? null,
      action,
      entity,
      summary,
      periodId: periodId ?? null,
    },
  });
}

// Record a BLOCKED / denied action attempt so a silent guard-return stops being invisible: it emits one
// JSON log line (Vercel Runtime Logs) AND writes an ActivityLog row (action "blocked") the head can see
// in /activity. This is how we catch "I tapped it and nothing happened" without asking the member to
// reproduce it — and how we confirm a permission fix actually worked.
async function logBlocked(
  tag: string,
  entity: string,
  reason: string,
  summary: string,
  periodId?: number | null,
) {
  const session = await auth();
  log.warn(tag, "blocked", { outcome: "blocked", reason, memberId: session?.user?.memberId ?? null, periodId: periodId ?? null });
  try {
    const household = await prisma.household.findFirst({ select: { id: true } });
    if (!household) return;
    await prisma.activityLog.create({
      data: {
        householdId: household.id,
        memberId: session?.user?.memberId ?? null,
        memberName: session?.user?.memberName ?? session?.user?.name ?? null,
        action: "blocked",
        entity,
        summary: `${summary} — blocked: ${reason}`,
        periodId: periodId ?? null,
      },
    });
  } catch {
    /* logging must never break the request it's describing */
  }
}

const VIEW_AS_COOKIE = "view-as";

// The head can temporarily "view as member" (read-only) so they — or someone
// handed the phone — can't edit by mistake. This downgrades the EFFECTIVE role
// used by every guard below; the real session role is unchanged.
async function effectiveRole(): Promise<string> {
  const session = await auth();
  const role = session?.user?.role ?? "member";
  if (role !== "head") return role;
  const viewAs = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  return viewAs === "member" ? "member" : "head";
}

export async function setViewAs(formData: FormData) {
  // only a REAL head may toggle (checked on the raw session, so a head in member
  // view can still switch back)
  const session = await auth();
  if (session?.user?.role !== "head") return;
  const jar = await cookies();
  if (String(formData.get("mode")) === "member") {
    jar.set(VIEW_AS_COOKIE, "member", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  } else {
    jar.delete(VIEW_AS_COOKIE);
  }
  revalidateFamily();
}

export async function doSignOut() {
  await signOut({ redirectTo: "/signin" });
}

// On-demand cache bust. All family reads (getInHand / getRollup / getSettlement) are memoized under
// FAMILY_TAG and normally only refresh on a write or the 1h backstop — so after a code deploy a cached
// result can look stale until someone touches data. This forces an immediate recompute with no data
// change (read-only, so any signed-in family member may run it), for the "refresh when I want" case.
export async function refreshData(): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user) return { ok: false };
  revalidateFamily();
  return { ok: true };
}

// App-lock: when the household has a shared PIN, every mutation also requires the
// device to be unlocked — this closes the direct-API bypass of the /lock gate
// (the gate itself only protects page reads via loadCommon).
async function unlocked() {
  const household = await prisma.household.findFirst({ select: { id: true, pinHash: true } });
  if (!household?.pinHash) return true; // no lock configured
  return await isUnlocked(household.id);
}

// The page the current action was fired from (so a forced re-lock can send the user back there
// after they re-enter the PIN, instead of dumping them on the home tab).
async function currentPath(): Promise<string | null> {
  const ref = (await headers()).get("referer");
  if (!ref) return null;
  try { const u = new URL(ref); return u.pathname + u.search; } catch { return null; }
}

// Log a collapsed app-lock and bounce to the PIN, remembering where to return.
async function relock(tag: string): Promise<never> {
  const session = await auth();
  const next = await currentPath();
  log.warn(tag, "relock", { outcome: "blocked", reason: "app-locked", memberId: session?.user?.memberId ?? null, next });
  redirect(next ? `/lock?next=${encodeURIComponent(next)}` : "/lock");
}

// Gate every mutating action on the app-lock. If the session lock has collapsed, log it and
// bounce to the PIN (forces a clean re-unlock) instead of the old silent no-op that made
// actions look broken. `tag` is the action name so the log line says which one was blocked.
async function requireUnlocked(tag: string): Promise<void> {
  if (await unlocked()) return;
  await relock(tag);
}

// Authorization from the EFFECTIVE role (honours the head's "view as member").
async function isHead() {
  if ((await effectiveRole()) !== "head") return false;
  return await unlocked();
}

// Head + Manager may add/edit/delete income & expenses. Members are read-only
// (they can still log their own spends via addSpend).
async function canEdit() {
  const role = await effectiveRole();
  if (role !== "head" && role !== "manager") return false;
  return await unlocked();
}

async function periodOpen(periodId: number) {
  const p = await prisma.period.findUnique({ where: { id: periodId } });
  return p?.status === "open";
}

// Settlement lock: once ANY transfer for the month is marked paid, money has moved to
// the treasurer against the shown numbers — so non-heads can't change the sheet's
// planned expense/income any more (daily spends still flow; the head can still edit).
async function periodSettlementLocked(periodId: number) {
  return (await prisma.settlementRecord.count({ where: { periodId } })) > 0;
}

// May this caller edit sheet entries in this period right now?
// Head can edit any month (incl. closed / settled); Manager only while the month is
// open AND not settlement-locked.
async function canEditNow(periodId: number) {
  if (await isHead()) return true;
  if (!(await periodOpen(periodId))) return false;
  return !(await periodSettlementLocked(periodId));
}

// Success signal for useActionState-driven modals (close + reset only on real success).
export type FundSource = { memberId: number; name: string; spare: number; isTreasurer?: boolean };
export type SaveShortfall = { toMemberId: number; toName: string; amount: number; day: number | null };
export type SaveState = { ok: boolean; n: number; error?: string; shortfall?: SaveShortfall; sources?: FundSource[] };

// "Repeat every month" promotion: when a line is added with repeat on, ensure a
// matching RecurringItem exists in the template (source of truth) so it generates
// every month. Matched by household + kind + name (+ category for expenses).
async function promoteToTemplate(
  periodId: number,
  kind: "income" | "expense",
  name: string,
  amount: number,
  categoryId: number | null,
  memberId: number | null,
  dueDay: number | null = null,
) {
  const period = await prisma.period.findUnique({ where: { id: periodId }, select: { householdId: true } });
  if (!period) return;
  const householdId = period.householdId;
  // Budgeted categories (tracked envelopes AND flat fixed bills) own their monthly amount
  // in Budgets & sinking funds — generation builds their line from the Category, so a
  // promoted template item would only clutter Setup (and is ignored anyway). Skip it.
  if (kind === "expense" && categoryId != null) {
    const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { monthlyBudget: true } });
    if (cat?.monthlyBudget != null && cat.monthlyBudget > 0) return;
  }
  const existing = await prisma.recurringItem.findFirst({
    where: { householdId, kind, name, ...(kind === "expense" ? { categoryId } : {}) },
  });
  if (existing) {
    await prisma.recurringItem.update({ where: { id: existing.id }, data: { amount, memberId, active: true, ...(dueDay != null ? { dueDay } : {}) } });
  } else {
    const max = await prisma.recurringItem.aggregate({ where: { householdId }, _max: { sortOrder: true } });
    await prisma.recurringItem.create({
      data: { householdId, kind, name, amount, categoryId: kind === "expense" ? categoryId : null, memberId, dueDay, sortOrder: (max._max.sortOrder ?? 0) + 1 },
    });
  }
}

// Add-expense timing gate: would a NEW dated expense make the money plan unpayable? Simulates the
// plan with the expense injected (not persisted) and blocks only if it introduces a shortfall that
// wasn't already there — the payer can't cover it in time, the treasurer runs short, or a disbursement
// gets pushed past its due day. Undated expenses have no timing deadline, so they're never gated here.
async function checkAddExpenseFeasible(
  periodId: number,
  hyp: { amount: number; dueDay: number | null; payerId: number | null; label: string; isMisc?: boolean },
): Promise<{ ok: true } | { ok: false; reason: string; shortfall?: SaveShortfall; sources?: FundSource[] }> {
  if (hyp.dueDay == null) return { ok: true };
  const period = await prisma.period.findUnique({ where: { id: periodId }, select: { householdId: true, treasurerMemberId: true } });
  if (!period) return { ok: true };
  const hh = period.householdId;
  const members = await prisma.member.findMany({ where: { householdId: hh }, select: { id: true, name: true } });
  const payerName = members.find((m) => m.id === hyp.payerId)?.name ?? "Shared";
  // The hub/treasurer is a special funding source: the treasurer covering a misc line isn't a peer LOAN
  // (front + payback of the gap) — it's the family POOL paying the FULL amount, no payback. Surfaced for
  // misc-under-member so picking it pool-funds the whole expense (see the modal). Resolve once here.
  const household = await prisma.household.findUnique({ where: { id: hh }, select: { treasurerMemberId: true } });
  const headMember = await prisma.member.findFirst({ where: { householdId: hh, role: "head" }, select: { id: true } });
  const treasurerId = period.treasurerMemberId ?? household?.treasurerMemberId ?? headMember?.id ?? null;
  const treasurerName = members.find((m) => m.id === treasurerId)?.name ?? "Treasurer";
  const hypBill = { key: "__hyp__", payerId: hyp.payerId, payerName, vendor: hyp.label, amount: hyp.amount, done: false, day: hyp.dueDay, status: null, days: null };
  // A NON-misc bill assigned to a member is pool-funded: saving it makes the pool OWE that member, so
  // the plan disburses treasurer→member to cover it. Fold it into the settlement side of the preview so
  // the gate sees that funding (and only flags a genuine collection-timing problem). Misc lines keep the
  // old pool-or-peer prompt (they're not settlement-funded unless the user picks pool).
  const hypExpense =
    !hyp.isMisc && hyp.payerId != null
      ? [{ memberId: hyp.payerId, amount: hyp.amount, label: hyp.label, category: { name: hyp.label, section: "Monthly" } }]
      : undefined;
  const [base, withHyp] = await Promise.all([getMoneyPlan(hh, periodId), getMoneyPlan(hh, periodId, undefined, [hypBill], hypExpense)]);
  const inr = (n: number) => formatINR(Math.round(n));
  // 1. the expense's own payer can't cover it by its due day → offer to fund it from whoever holds
  //    spare cash right before that step (the dropdown of sources the user picks from).
  const hypStep = withHyp.steps.find((s) => s.id === "__hyp__");
  if (hypStep?.senderShort != null && hypStep.senderShort > 0.5) {
    // A member's own (non-misc) bill is pool-funded — the pool now owes them for it (folded in above),
    // so a remaining shortfall means the pool can't COLLECT the cash by the due day. Block and ask for a
    // later date rather than offering a peer advance (the treasurer funds it once collected).
    if (!hyp.isMisc) {
      return { ok: false, reason: `The pool can't gather ${inr(hypStep.senderShort)} for ${payerName} by day ${hyp.dueDay} — the money isn't collected by then. Try a later due date.` };
    }
    // Peer funders = anyone (NOT the payer, NOT the treasurer) holding spare cash right before the step;
    // each fronts part of the gap as an advance. The treasurer is handled separately as the pool option.
    const peers: FundSource[] =
      hyp.payerId == null
        ? []
        : members
            .filter((m) => m.id !== hyp.payerId && m.id !== treasurerId)
            .map((m) => ({ memberId: m.id, name: m.name, spare: Math.round(hypStep.balancesBefore?.[m.id] ?? 0) }))
            .filter((s) => s.spare > 0.5)
            .sort((a, b) => b.spare - a.spare);
    // For a MISC line under a member, offer the treasurer FIRST as the pool option — pay the full amount
    // from the pool (no payback), independent of the treasurer's own spare cash. Picking it pool-funds
    // the whole expense (the modal flips it to poolFund), not a partial advance of the gap.
    const poolOption: FundSource[] =
      hyp.isMisc && hyp.payerId != null && treasurerId != null && treasurerId !== hyp.payerId
        ? [{ memberId: treasurerId, name: treasurerName, spare: Math.round(hyp.amount), isTreasurer: true }]
        : [];
    const sources: FundSource[] = [...poolOption, ...peers];
    return {
      ok: false,
      reason: `${payerName} would be short ${inr(hypStep.senderShort)} on day ${hyp.dueDay}.`,
      shortfall: hyp.payerId == null ? undefined : { toMemberId: hyp.payerId, toName: payerName, amount: Math.round(hypStep.senderShort), day: hyp.dueDay },
      sources,
    };
  }
  // 2. it makes some OTHER bill unpayable in time — a knock-on shortfall the plan didn't have before.
  //    The hyp bill's OWN shortfall is handled in step 1; hub disbursements are now capped to collected
  //    cash (never over-emitted), so the old hub-short / infeasible-disbursement signals are replaced by
  //    the per-bill short count: block if adding this expense pushes any other bill into shortfall.
  if (withHyp.shortBills > base.shortBills) {
    const baseShort = new Set(base.steps.filter((s) => s.kind === "bill" && (s.senderShort ?? 0) > 0.005).map((s) => s.id));
    const hit = withHyp.steps.find((s) => s.kind === "bill" && (s.senderShort ?? 0) > 0.005 && s.id !== "__hyp__" && !baseShort.has(s.id));
    const who = hit?.payerName ?? "another payment";
    return {
      ok: false,
      reason: hit?.infeasibleFrom != null
        ? `This would leave ${who} short on "${hit.vendor ?? "a bill"}" — payable only from day ${hit.infeasibleFrom}. Try a later due date.`
        : `This would leave ${who} short on a bill this month. Try a later due date.`,
    };
  }
  return { ok: true };
}

// Create (no id) or update (id present). Head/Manager; head may edit closed months.
// Returns {ok} on success, or {ok:false, error} with a reason the UI can show. Note (label) is REQUIRED.
async function doSaveExpense(formData: FormData): Promise<{ ok: boolean; error?: string; shortfall?: SaveShortfall; sources?: FundSource[] }> {
  if (!(await canEdit())) return { ok: false };

  const id = formData.get("id") ? Number(formData.get("id")) : null;
  const periodId = Number(formData.get("periodId"));
  // "Make it a spend card": a NEW misc line the household budgets and members spend into (like
  // veggies), not a one-shot bill. Delegates to the budgeted-card path — no funding/pool/dueDay.
  if (!id && formData.get("spendCard") === "on") {
    if (!(await canEditNow(periodId))) return { ok: false };
    return doAddMiscSpendCard(formData);
  }
  let categoryId = Number(formData.get("categoryId")) || 0;
  const amount = parseAmount(formData.get("amount"));
  const label = String(formData.get("label") ?? "").trim();
  const memberRaw = formData.get("memberId");
  const memberId = memberRaw ? Number(memberRaw) : null;
  const necessaryRaw = formData.get("necessary"); // "default" | "yes" | "no"
  // Optional day-of-month the expense is due (drives Money-plan ordering / overdue tags). Blank = undated.
  const dueRaw = String(formData.get("dueDay") ?? "").trim();
  const dueNum = dueRaw === "" ? null : Number(dueRaw);
  const dueDay = dueNum != null && Number.isFinite(dueNum) && dueNum >= 1 && dueNum <= 31 ? Math.round(dueNum) : null;
  const hasDueField = formData.has("dueDay"); // only touch dueDay when the form actually sent it

  if (!periodId || !amount || !label) return { ok: false }; // note required
  if (!(await canEditNow(periodId))) return { ok: false };

  // create-a-new-category-on-the-fly (e.g. "YouTube" under Monthly) when none is picked
  const newCatName = String(formData.get("newCategoryName") ?? "").trim();
  if (!categoryId && newCatName) {
    const period = await prisma.period.findUnique({ where: { id: periodId } });
    if (!period) return { ok: false };
    const section = String(formData.get("newCategorySection") ?? "Monthly");
    const existing = await prisma.category.findFirst({
      where: { householdId: period.householdId, name: newCatName },
    });
    categoryId =
      existing?.id ??
      (await prisma.category.create({
        data: { householdId: period.householdId, name: newCatName, section },
      })).id;
  }
  if (!categoryId) return { ok: false };

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  const necessary =
    necessaryRaw === "yes" ? true : necessaryRaw === "no" ? false : (category?.necessary ?? true);
  // auto-attribute to the category's responsible member when none is picked
  const finalMemberId = memberId ?? category?.responsibleMemberId ?? null;

  if (id) {
    // A line already paid in the money plan is frozen — the head can edit anything else all month, but
    // a paid step is paid (editing it would silently redraw a payment that already happened).
    const existing = await prisma.expenseEntry.findUnique({ where: { id }, select: { paid: true, amount: true, dueDay: true, note: true } });
    if (existing?.paid) return { ok: false, error: "This is already paid in the money plan — it can’t be changed." };
    // Editing the VALUE (amount / due-day) on the Sheet pins this line for the month: a later
    // refresh-from-Setup leaves the intentional override alone (until it's un-pinned). Editing only
    // the label / member / necessary flag doesn't pin — those aren't touched by the Setup sync.
    const valueChanged = existing != null && (existing.amount !== amount || (hasDueField && existing.dueDay !== dueDay));
    await prisma.expenseEntry.update({
      where: { id },
      data: { categoryId, amount, label, memberId: finalMemberId, necessary, ...(hasDueField ? { dueDay } : {}), ...(valueChanged ? { pinned: true } : {}) },
    });
    await logActivity("expense", "updated", `Edited expense “${label}” to ${formatINR(amount)}`, periodId);
  } else {
    // A new expense added while the month is in its wind-down overhang (calendar past it, not yet
    // wound down) is DEFERRED: kept out of the frozen settlement so paid transfers don't shift, and
    // settled at wind-down by its assignee. It's still a real expense of this month otherwise.
    const per = await prisma.period.findUnique({ where: { id: periodId }, select: { year: true, month: true, status: true } });
    // Phase 2 sheet-lock: once a month's OWN calendar month has ended, no NEW expenses may be added to
    // it (settlement/finalisation still runs until wind-down). Grandfathered — months whose month-end
    // passed before Phase 2 shipped (≤ Jul 2026) stay finishable the old way through their wind-down.
    const ord = (y: number, m: number) => y * 12 + m;
    const nowIST = istYearMonth();
    if (per && ord(per.year, per.month) < ord(nowIST.year, nowIST.month) && ord(per.year, per.month) >= ord(2026, 8)) {
      return { ok: false, error: "That month has ended — add this to the current month instead." };
    }
    const deferred = per ? inWindDownOverhang(per) : false;
    // Pool-funded misc: the treasurer pays the full amount to the assigned member (family money, no
    // payback) instead of the member self-funding it. Only valid when a member is actually assigned —
    // otherwise it's just a normal (shared/own) expense. Skips the shortfall gate + funding advances.
    const poolFund = formData.get("poolFund") === "on" && finalMemberId != null && !deferred;
    // Two-step variant: the hub disburses to the member AND a separate "member → vendor" payment step is
    // added (independently tickable). Only meaningful when pool-funding, so gate on poolFund.
    const poolBill = poolFund && formData.get("poolBill") === "on";
    // Guard: a new expense can't exceed the month's current balance (income − expense).
    const [inc, exp] = await Promise.all([
      prisma.incomeEntry.aggregate({ where: { periodId }, _sum: { amount: true } }),
      prisma.expenseEntry.aggregate({ where: { periodId }, _sum: { amount: true } }),
    ]);
    const bal = (inc._sum.amount ?? 0) - (exp._sum.amount ?? 0);
    if (amount > bal) return { ok: false, error: `That's more than the month's balance (${formatINR(bal)}).` };
    // A confirmed funding choice: the user picked who fronts the shortfall — one OR MORE people (a big
    // shortfall can be split across funders). The form sends `funders` = JSON [{memberId, amount}];
    // legacy single-source falls back to fundFrom/fundAmount. An optional paybackDayOverride pins the
    // return day for every advance created here (blank = auto, computed live from income arrivals).
    let funders: { memberId: number; amount: number }[] = [];
    const fundersRaw = String(formData.get("funders") ?? "").trim();
    if (fundersRaw) {
      try {
        funders = (JSON.parse(fundersRaw) as { memberId: number; amount: number }[])
          .filter((f) => f && Number(f.memberId) > 0 && Number(f.amount) > 0)
          .map((f) => ({ memberId: Number(f.memberId), amount: Math.round(Number(f.amount) * 100) / 100 }));
      } catch { funders = []; }
    } else {
      const fundFrom = formData.get("fundFrom") ? Number(formData.get("fundFrom")) : null;
      const fundAmount = formData.get("fundAmount") ? parseAmount(formData.get("fundAmount")) : 0;
      if (fundFrom && fundAmount > 0) funders = [{ memberId: fundFrom, amount: fundAmount }];
    }
    const funding = funders.length > 0;
    const pbRaw = String(formData.get("paybackDayOverride") ?? "").trim();
    const pbNum = pbRaw === "" ? null : Number(pbRaw);
    const paybackOverride = pbNum != null && Number.isFinite(pbNum) && pbNum >= 1 && pbNum <= 31 ? Math.round(pbNum) : null;
    // Timing gate: a DATED expense that can't be paid in order is blocked — UNLESS the user is funding
    // it. Deferred lines skip the gate (they always settle at wind-down, not against a due date).
    if (!deferred && !funding && !poolFund) {
      const feas = await checkAddExpenseFeasible(periodId, { amount, dueDay, payerId: finalMemberId, label, isMisc: category?.section === "Misc" });
      if (!feas.ok) return { ok: false, error: feas.reason, shortfall: feas.shortfall, sources: feas.sources };
    }
    // "Repeat every month" (checkbox) → also add to the recurring template so it's generated every
    // month; unchecked → one-off (this month only). A deferred line is always one-off.
    const oneOff = deferred || formData.get("repeat") !== "on";
    await prisma.expenseEntry.create({
      data: { periodId, categoryId, amount, label, memberId: finalMemberId, necessary, oneOff, dueDay, ...(deferred ? { note: DEFERRED_NOTE } : poolBill ? { note: POOL_BILL_NOTE } : poolFund ? { note: POOL_NOTE } : {}) },
    });
    if (!oneOff) await promoteToTemplate(periodId, "expense", label, amount, categoryId, finalMemberId);
    // Record the funding advances (one per funder) so each front + payback appears in the plan.
    if (funding && !poolFund && finalMemberId != null) {
      let total = 0;
      for (const f of funders) {
        if (f.memberId === finalMemberId) continue; // a member can't fund themselves
        await prisma.advance.create({ data: { periodId, fromMemberId: f.memberId, toMemberId: finalMemberId, amount: f.amount, day: dueDay, paybackDay: paybackOverride, note: `Funds ${label}` } });
        total += f.amount;
      }
      if (total > 0) await logActivity("settlement", "created", `Advance${funders.length > 1 ? "s" : ""} to cover “${label}” (${formatINR(total)})`, periodId);
    }
    await logActivity("expense", "created", `Added ${deferred ? "deferred " : ""}expense “${label}” ${formatINR(amount)}`, periodId);
  }
  revalidateFamily();
  return { ok: true };
}

export async function saveExpense(formData: FormData) {
  await doSaveExpense(formData);
}
export async function saveExpenseAction(prev: SaveState, formData: FormData): Promise<SaveState> {
  const { ok, error, shortfall, sources } = await doSaveExpense(formData);
  return { ok, n: ok ? prev.n + 1 : prev.n, error: ok ? undefined : error, shortfall: ok ? undefined : shortfall, sources: ok ? undefined : sources };
}

// Returns true on success. Source (the note/description) is REQUIRED.
async function doAddIncome(formData: FormData): Promise<boolean> {
  if (!(await canEdit())) return false;
  const periodId = Number(formData.get("periodId"));
  const source = String(formData.get("source") ?? "").trim();
  const amount = parseAmount(formData.get("amount"));
  const ownerRaw = formData.get("ownerId");
  const ownerId = ownerRaw ? Number(ownerRaw) : null;
  // Arrival day (optional): drives the Money-plan ordering — when this income lands.
  const dueNum = Number(String(formData.get("dueDay") ?? "").trim());
  const dueDay = Number.isFinite(dueNum) && dueNum >= 1 && dueNum <= 31 ? Math.round(dueNum) : null;

  if (!periodId || !source || !amount) return false;
  if (!(await canEditNow(periodId))) return false;

  // "Repeat every month" → also add to the recurring template; unchecked → one-time
  const oneOff = formData.get("repeat") !== "on";
  await prisma.incomeEntry.create({ data: { periodId, source, amount, ownerId, oneOff, dueDay } });
  if (!oneOff) await promoteToTemplate(periodId, "income", source, amount, null, ownerId, dueDay);
  await logActivity("income", "created", `Added income “${source}” ${formatINR(amount)}`, periodId);
  revalidateFamily();
  return true;
}

export async function addIncome(formData: FormData) {
  await doAddIncome(formData);
}
export async function addIncomeAction(prev: SaveState, formData: FormData): Promise<SaveState> {
  const ok = await doAddIncome(formData);
  return { ok, n: ok ? prev.n + 1 : prev.n };
}

// Edit an income line (source / amount / owner). HEAD ONLY — income drives
// settlement, so a single owner edits it (add stays head+manager).
export async function updateIncome(prev: SaveState, formData: FormData): Promise<SaveState> {
  if (!(await isHead())) return { ok: false, n: prev.n };
  const id = Number(formData.get("id"));
  const source = String(formData.get("source") ?? "").trim();
  const amount = parseAmount(formData.get("amount"));
  const ownerRaw = formData.get("ownerId");
  const ownerId = ownerRaw ? Number(ownerRaw) : null;
  const hasDueField = formData.has("dueDay");
  const dueNum = Number(String(formData.get("dueDay") ?? "").trim());
  const dueDay = Number.isFinite(dueNum) && dueNum >= 1 && dueNum <= 31 ? Math.round(dueNum) : null;
  if (!id || !source || !amount) return { ok: false, n: prev.n };
  const i = await prisma.incomeEntry.findUnique({ where: { id } });
  if (!i || !(await canEditNow(i.periodId))) return { ok: false, n: prev.n };
  // A month-specific amount/date edit pins the line so a refresh-from-Setup won't revert it (until un-pinned).
  const pin = i.amount !== amount || (hasDueField && i.dueDay !== dueDay) ? { pinned: true } : {};
  await prisma.incomeEntry.update({ where: { id }, data: { source, amount, ownerId, ...(hasDueField ? { dueDay } : {}), ...pin } });
  await logActivity("income", "updated", `Edited income “${source}” to ${formatINR(amount)}`, i.periodId);
  revalidateFamily();
  return { ok: true, n: prev.n + 1 };
}

// A Setup-generated line (oneOff:false, no marker note) is SOFT-deleted into a "removed" tombstone so
// the removal is a persistent override a rebuild/sync won't undo (see REMOVED_NOTE). Hand-added
// one-offs and estimate/marker lines hard-delete as before — generateMonth never re-creates those.
const isGeneratedLine = (row: { oneOff: boolean; note: string | null }) => !row.oneOff && row.note == null;

export async function deleteExpense(formData: FormData) {
  if (!(await canEdit())) return;
  const id = Number(formData.get("id"));
  if (!id) return;
  const e = await prisma.expenseEntry.findUnique({ where: { id } });
  if (!e) return;
  if (!(await canEditNow(e.periodId))) return;
  if (e.paid) return; // a line already paid in the money plan is frozen — paid is paid
  if (isGeneratedLine(e)) {
    // Tombstone: amount 0 keeps every total correct; note+pinned+oneOff make it a persistent override.
    // Its budget envelope (if any) goes too, so the category isn't budgeted this month.
    await prisma.$transaction(async (tx) => {
      await tx.expenseEntry.update({ where: { id }, data: { note: REMOVED_NOTE, amount: 0, pinned: true, oneOff: true } });
      await tx.budget.deleteMany({ where: { periodId: e.periodId, categoryId: e.categoryId ?? -1 } });
    });
  } else {
    await prisma.expenseEntry.delete({ where: { id } });
  }
  await logActivity("expense", "deleted", `Removed expense “${e.label}” ${formatINR(e.amount)}`, e.periodId);
  revalidateFamily();
}

export async function deleteIncome(formData: FormData) {
  if (!(await canEdit())) return;
  const id = Number(formData.get("id"));
  if (!id) return;
  const i = await prisma.incomeEntry.findUnique({ where: { id } });
  if (!i) return;
  if (!(await canEditNow(i.periodId))) return;
  if (isGeneratedLine(i)) {
    await prisma.incomeEntry.update({ where: { id }, data: { note: REMOVED_NOTE, amount: 0, pinned: true, oneOff: true } });
  } else {
    await prisma.incomeEntry.delete({ where: { id } });
    // Removing a general-Piggy income line shrinks (or clears) the holder's hand-over to the treasurer.
    if (i.note === PIGGY_INCOME_NOTE) {
      const period = await prisma.period.findUnique({ where: { id: i.periodId }, select: { householdId: true } });
      if (period) await syncPiggyHandover(period.householdId, i.periodId);
    }
  }
  await logActivity("income", "deleted", `Removed income “${i.source}” ${formatINR(i.amount)}`, i.periodId);
  revalidateFamily();
}

// Restore a "removed" tombstone back to a live Setup line, IN PLACE (same row): clear the removed
// marker, make it a normal generated line again (oneOff:false, unpinned) and re-pull its amount/day
// from the current Setup template — the exact value a fresh generate would give. A tracked budget
// envelope also gets its Budget row back. Head/manager, editable months (open OR the preview draft).
export async function restoreLine(formData: FormData) {
  if (!(await canEdit())) return;
  const kind = String(formData.get("kind") ?? ""); // "income" | "expense"
  const id = Number(formData.get("id"));
  if (!id || (kind !== "income" && kind !== "expense")) return;

  if (kind === "income") {
    const inc = await prisma.incomeEntry.findUnique({ where: { id }, select: { ownerId: true, source: true, note: true, periodId: true, period: { select: { householdId: true } } } });
    if (!inc || inc.note !== REMOVED_NOTE || !(await canEditNow(inc.periodId))) return;
    const items = await prisma.recurringItem.findMany({ where: { householdId: inc.period.householdId, active: true, kind: "income" } });
    const cands = items.filter((it) => it.memberId === inc.ownerId);
    const it = cands.length === 1 ? cands[0] : cands.find((x) => stripInstNumber(x.name) === stripInstNumber(inc.source));
    await prisma.incomeEntry.update({ where: { id }, data: { note: null, oneOff: false, pinned: false, ...(it ? { amount: it.amount, dueDay: it.dueDay } : {}) } });
    await logActivity("income", "updated", `Restored income “${inc.source}”`, inc.periodId);
    revalidateFamily();
    return;
  }

  const exp = await prisma.expenseEntry.findUnique({
    where: { id },
    select: { categoryId: true, memberId: true, label: true, note: true, periodId: true, period: { select: { householdId: true } },
      category: { select: { fundingStyle: true, billEveryMonths: true, billDay: true, billAmount: true, monthlyBudget: true, tracked: true } } },
  });
  if (!exp || exp.note !== REMOVED_NOTE || !(await canEditNow(exp.periodId))) return;
  const cat = exp.category;
  const isBudget = cat.fundingStyle == null && cat.billEveryMonths == null && cat.monthlyBudget != null && cat.monthlyBudget > 0;
  const isFullBill = cat.fundingStyle == null && cat.billEveryMonths != null && cat.billAmount != null && cat.billAmount > 0;
  if (isBudget) {
    await prisma.$transaction([
      prisma.expenseEntry.update({ where: { id }, data: { note: null, oneOff: false, pinned: false, amount: cat.monthlyBudget! } }),
      ...(cat.tracked && exp.categoryId != null
        ? [prisma.budget.upsert({ where: { periodId_categoryId: { periodId: exp.periodId, categoryId: exp.categoryId } }, create: { periodId: exp.periodId, categoryId: exp.categoryId, planned: cat.monthlyBudget! }, update: { planned: cat.monthlyBudget! } })]
        : []),
    ]);
  } else if (isFullBill) {
    await prisma.expenseEntry.update({ where: { id }, data: { note: null, oneOff: false, pinned: false, amount: cat.billAmount!, dueDay: cat.billDay } });
  } else {
    const items = await prisma.recurringItem.findMany({ where: { householdId: exp.period.householdId, active: true, kind: "expense", categoryId: exp.categoryId } });
    const cands = items.filter((x) => x.memberId === exp.memberId);
    const it = cands.length === 1 ? cands[0] : cands.find((x) => stripInstNumber(x.name) === stripInstNumber(exp.label));
    await prisma.expenseEntry.update({ where: { id }, data: { note: null, oneOff: false, pinned: false, ...(it ? { amount: it.amount, dueDay: it.dueDay } : {}) } });
  }
  await logActivity("expense", "updated", `Restored expense “${exp.label}”`, exp.periodId);
  revalidateFamily();
}

// Save an uploaded image to public/uploads and return its public path, or null.
async function saveUpload(_file: FormDataEntryValue | null): Promise<string | null> {
  // Receipt uploads deferred for v1: the serverless host has an ephemeral/read-only
  // filesystem, so local fs writes don't work. Re-enable via Supabase Storage later.
  // (No-op for now; the file input is hidden in AddSpendModal.)
  return null;
}

// The family's calendar month is IST (UTC+5:30): a spend logged just after midnight on the 1st belongs
// to the NEW month, not the prior UTC day. Returns today's { year, month } in IST.
function istYearMonth(now = new Date()): { year: number; month: number } {
  const ist = new Date(now.getTime() + 330 * 60000);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1 };
}

// Log an actual spend in a tracked category (Expenses tab).
// ANY signed-in member can log — auto-attributed to themselves (like the WhatsApp groups).
// Field-tagged result so the modal can point at the offending input and toast the reason, instead of a
// silent boolean that left the modal looking hung. `field` matches the client's input names.
type SpendResult = { ok: true } | { ok: false; error: string; field?: "amount" | "category" | "label" | "subCategory" };

async function doAddSpend(formData: FormData): Promise<SpendResult> {
  const session = await auth();
  const selfId = session?.user?.memberId;
  if (!selfId) return { ok: false, error: "Please sign in again." }; // must be a mapped member
  await requireUnlocked("deleteIncome");

  const periodId = Number(formData.get("periodId"));
  const categoryId = Number(formData.get("categoryId"));
  const amount = parseAmount(formData.get("amount"));
  const label = String(formData.get("label") ?? "").trim();

  if (!amount) return { ok: false, error: "Enter an amount.", field: "amount" };
  if (!categoryId) return { ok: false, error: "Pick a category.", field: "category" };
  if (!label) return { ok: false, error: "Enter what was bought.", field: "label" };
  if (!periodId) return { ok: false, error: "Couldn't find the month — reopen and try again." };
  if (!(await periodOpen(periodId))) return { ok: false, error: "This month is closed." };

  // Misc (Personal/Misc) spends must carry a reporting sub-category (Food, Travel…);
  // other categories already are a category, so it stays null there.
  const subCategoryRaw = String(formData.get("subCategory") ?? "").trim();
  const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { section: true, tracked: true, householdId: true, name: true } });
  const misc = cat ? isMiscBucket(cat) : false;
  if (misc && !subCategoryRaw) return { ok: false, error: "Pick a kind of spend.", field: "subCategory" };
  const subCategory = misc && subCategoryRaw ? subCategoryRaw : null;

  // "Be specific" — reject a note that just restates the category ("veggies", "provision") or a bare fuel
  // word. Authoritative server-side twin of the modal's instant check (see validateSpendLabel).
  const labelErr = validateSpendLabel(label, cat?.name ?? "");
  if (labelErr) return { ok: false, error: labelErr, field: "label" };

  // Only the head may log a spend on behalf of another member; everyone else = self.
  const overrideId = Number(formData.get("memberId")) || 0;
  let memberId = overrideId && session?.user?.role === "head" ? overrideId : selfId;
  // Paid with a family card? The card is the authority on who paid — attribute the spend to the card's
  // OWNER (regardless of who logged it), and record the card. Any member may pick any family card; it
  // can only ever attribute to that card's owner, so it can't fabricate someone else's cash spend.
  const cardAccountId = Number(formData.get("cardAccountId")) || 0;
  let cardId: number | null = null;
  let cardOwnerId: number | null = null; // set for any valid family card → mirror to the owner's card ledger
  if (cardAccountId) {
    const card = await prisma.financeAccount.findUnique({ where: { id: cardAccountId }, select: { memberId: true, active: true, type: true, member: { select: { householdId: true } } } });
    if (card && card.active && cat && card.member.householdId === cat.householdId) {
      memberId = card.memberId; // card owner bore the cost
      cardId = cardAccountId;
      cardOwnerId = card.memberId;
    }
  }

  // Phase 2: a spend belongs to the CALENDAR month it happened in (IST), not whichever month is still
  // "working". Route it to today's month so a spend logged in the new month can never backfill a month
  // being wound down. Falls back to the submitted period during the brief boundary before the new
  // month's period is live (or when it already matches).
  let targetPeriodId = periodId;
  if (cat) {
    const { year, month } = istYearMonth();
    const current = await prisma.period.findUnique({
      where: { householdId_year_month: { householdId: cat.householdId, year, month } },
      select: { id: true, status: true },
    });
    if (current && current.status === "open" && current.id !== periodId) targetPeriodId = current.id;
  }

  const imagePath = await saveUpload(formData.get("image"));
  const spend = await prisma.spend.create({
    data: { periodId: targetPeriodId, categoryId, memberId, label, amount, subCategory, imagePath, cardAccountId: cardId, loggedById: selfId },
  });
  // Paid with a family card? Mirror it onto the card OWNER's personal card ledger as a linked line, so
  // their personal view reflects the family spend (a member may use another member's card). For CREDIT
  // it drives the dashboard/outstanding; for DEBIT it's informational (no bill, no liability — see
  // getNetWorth/getWalletAccounts, which only compute outstanding for credit cards). Cash/UPI never
  // mirrors. The link (familySpendId) keeps edits in sync and cascades on delete.
  if (cardOwnerId != null && cardId != null) {
    await prisma.accountTransaction.create({
      data: {
        memberId: cardOwnerId,
        accountId: cardId,
        date: spend.createdAt,
        merchant: label,
        amount,
        type: "spend",
        category: cat?.name ?? null,
        source: "family",
        familySpendId: spend.id,
      },
    });
  }
  // Learn the item→category so future entries of the same thing get suggested. Only
  // deliberate tracked (non-misc) categorisations teach the app — misc is ambiguous
  // (the same item can be "for someone else"), so we never learn from it.
  if (cat && cat.tracked && !misc) await learnSpendItem(cat.householdId, label, categoryId);
  await logActivity("spend", "created", `Logged spend “${label}” ${formatINR(amount)}`, targetPeriodId);
  revalidateFamily();
  return { ok: true };
}

// Reinforce (or create) the item→category memory for this household. Best-effort:
// a learning failure must never block saving the spend.
async function learnSpendItem(householdId: number, label: string, categoryId: number) {
  const keyword = isLearnable(label);
  if (!keyword) return;
  try {
    await prisma.spendKeyword.upsert({
      where: { householdId_keyword: { householdId, keyword } },
      create: { householdId, keyword, categoryId, hits: 1 },
      update: { hits: { increment: 1 }, categoryId }, // latest categorisation wins the tie
    });
  } catch {
    /* learning is advisory — ignore races/errors */
  }
}

// Everything the Add-Spend modal needs, fetched lazily on open (so no page has to thread
// it through): the quick chips (head-curated shortcuts, or the most-frequent items when
// none are set up) + the keyword rows that drive the on-save suggestion.
export type SpendAssist = {
  chips: { icon: string | null; label: string; categoryId: number }[];
  keywords: { keyword: string; category: string; hits: number }[];
  cards: { id: number; name: string; ownerId: number; ownerName: string; last4: string | null; type: string; color: string }[];
  topCardId: number | null; // most-used card family-wide → featured as a quick chip in "Paid with"
};
export async function getSpendAssist(): Promise<SpendAssist> {
  const session = await auth();
  if (!session?.user) return { chips: [], keywords: [], cards: [], topCardId: null };
  const household = await prisma.household.findFirst({ select: { id: true } });
  if (!household) return { chips: [], keywords: [], cards: [], topCardId: null };
  const [shortcuts, keywords, cardRows, topCard] = await Promise.all([
    getSpendShortcuts(household.id),
    getMatcherKeywords(household.id),
    getFamilyCards(household.id), // active family cards for the "Paid with" picker
    // Most-used card across the household — surfaced as the one quick chip beside Cash.
    prisma.spend.groupBy({
      by: ["cardAccountId"],
      where: { cardAccountId: { not: null }, category: { householdId: household.id } },
      _count: { cardAccountId: true },
      orderBy: { _count: { cardAccountId: "desc" } },
      take: 1,
    }),
  ]);
  const chips = shortcuts.length
    ? shortcuts.map((s) => ({ icon: s.icon, label: s.label, categoryId: s.categoryId }))
    : (await getFrequentSpendItems(household.id)).map((f) => ({ icon: f.icon, label: f.label, categoryId: f.categoryId }));
  const cards = cardRows.map((c) => ({ id: c.id, name: c.name, ownerId: c.memberId, ownerName: c.member.name, last4: c.last4, type: c.type, color: c.color }));
  // Only feature it if it's still an active card in the list; else fall back to the first card.
  const rawTop = topCard[0]?.cardAccountId ?? null;
  const topCardId = cards.some((c) => c.id === rawTop) ? rawTop : (cards[0]?.id ?? null);
  return { chips, keywords, cards, topCardId };
}

// ── Quick-add chip management (head + managers) ──────────────────────────────
async function shortcutHousehold() {
  if (!(await canEdit())) return null; // head or manager only
  return prisma.household.findFirst({ select: { id: true } });
}
// The target category must be a real TRACKED category in this household (a chip that
// filed into a non-tracked or foreign category would be meaningless / unsafe).
async function validShortcutCategory(householdId: number, categoryId: number) {
  const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { householdId: true, tracked: true } });
  return !!cat && cat.householdId === householdId && cat.tracked;
}

export async function createSpendShortcut(formData: FormData) {
  const household = await shortcutHousehold();
  if (!household) return;
  const label = String(formData.get("label") ?? "").trim();
  const icon = String(formData.get("icon") ?? "").trim() || null;
  const categoryId = Number(formData.get("categoryId"));
  if (!label || !categoryId || !(await validShortcutCategory(household.id, categoryId))) return;
  const max = await prisma.spendShortcut.aggregate({ where: { householdId: household.id }, _max: { sortOrder: true } });
  await prisma.spendShortcut.create({
    data: { householdId: household.id, label, icon, categoryId, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  revalidateFamily();
}

export async function updateSpendShortcut(formData: FormData) {
  const household = await shortcutHousehold();
  if (!household) return;
  const id = Number(formData.get("id"));
  const sc = await prisma.spendShortcut.findUnique({ where: { id } });
  if (!sc || sc.householdId !== household.id) return;
  const label = String(formData.get("label") ?? "").trim();
  const icon = String(formData.get("icon") ?? "").trim() || null;
  const categoryId = Number(formData.get("categoryId")) || sc.categoryId;
  if (!label || !(await validShortcutCategory(household.id, categoryId))) return;
  await prisma.spendShortcut.update({ where: { id }, data: { label, icon, categoryId } });
  revalidateFamily();
}

export async function deleteSpendShortcut(formData: FormData) {
  const household = await shortcutHousehold();
  if (!household) return;
  const id = Number(formData.get("id"));
  const sc = await prisma.spendShortcut.findUnique({ where: { id } });
  if (!sc || sc.householdId !== household.id) return;
  await prisma.spendShortcut.delete({ where: { id } });
  revalidateFamily();
}

export async function moveSpendShortcut(formData: FormData) {
  const household = await shortcutHousehold();
  if (!household) return;
  const id = Number(formData.get("id"));
  const dir = String(formData.get("dir") ?? ""); // "up" | "down"
  const list = await prisma.spendShortcut.findMany({
    where: { householdId: household.id },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= list.length) return;
  const a = list[idx], b = list[swap];
  await prisma.$transaction([
    prisma.spendShortcut.update({ where: { id: a.id }, data: { sortOrder: b.sortOrder } }),
    prisma.spendShortcut.update({ where: { id: b.id }, data: { sortOrder: a.sortOrder } }),
  ]);
  revalidateFamily();
}

// Recategorise a spend from Misc into a tracked category (the "Review Misc" fix and the
// nudge's one-tap accept both use this). Head or the spend's owner, open month only.
// Moving out of Misc clears the misc-only reporting sub-category, and — since this is a
// deliberate correction — teaches the item→category memory too.
export async function moveSpendCategory(formData: FormData) {
  const session = await auth();
  if (!session?.user) return;
  await requireUnlocked("moveSpendCategory");
  const id = Number(formData.get("id"));
  const categoryId = Number(formData.get("categoryId"));
  if (!id || !categoryId) return;
  const spend = await prisma.spend.findUnique({ where: { id } });
  if (!spend) return;
  if (!(await periodOpen(spend.periodId))) return;
  const isOwner = spend.memberId === session.user.memberId;
  if (session.user.role !== "head" && !isOwner) return;

  const target = await prisma.category.findUnique({ where: { id: categoryId }, select: { tracked: true, section: true, householdId: true, name: true } });
  if (!target || !target.tracked) return; // only ever move INTO a real tracked category
  const nowMisc = isMiscBucket(target);

  await prisma.spend.update({
    where: { id },
    data: { categoryId, subCategory: nowMisc ? spend.subCategory : null },
  });
  if (!nowMisc) await learnSpendItem(target.householdId, spend.label, categoryId);
  await logActivity("spend", "updated", `Moved “${spend.label}” → ${target.name}`, spend.periodId);
  revalidateFamily();
}

// Dismiss a "Review Misc" suggestion: this misc spend is genuinely miscellaneous, so
// stop proposing a move for it. Head or owner, open month only. Reversible only by
// editing the spend (a fresh categorisation), which is fine — it's a one-way "leave it".
export async function ignoreMiscReview(formData: FormData) {
  const session = await auth();
  if (!session?.user) return;
  await requireUnlocked("ignoreMiscReview");
  const id = Number(formData.get("id"));
  if (!id) return;
  const spend = await prisma.spend.findUnique({ where: { id } });
  if (!spend) return;
  if (!(await periodOpen(spend.periodId))) return;
  const isOwner = spend.memberId === session.user.memberId;
  if (session.user.role !== "head" && !isOwner) return;
  await prisma.spend.update({ where: { id }, data: { reviewIgnored: true } });
  revalidateFamily();
}

// Plain form-action caller (card mode on the Expenses page): throw on failure so the wrapping
// useToastAction shows an error toast instead of a silent no-op.
export async function addSpend(formData: FormData) {
  const r = await doAddSpend(formData);
  if (!r.ok) throw new Error(r.error);
}

// useActionState caller (the quick-entry modal): returns a success signal so the UI can show "Saved ✓"
// and reset for the next item without closing. `n` increments on each successful save and drives the
// client-side reset effect; on failure it carries the reason + the field to point at. Wrapped in a
// try/catch so an unexpected throw resolves the action (the modal never stays stuck on "Saving…").
export type AddSpendState = { ok: boolean; n: number; error?: string; field?: "amount" | "category" | "label" | "subCategory" };
export async function addSpendAction(
  prev: AddSpendState,
  formData: FormData,
): Promise<AddSpendState> {
  try {
    const r = await doAddSpend(formData);
    return r.ok
      ? { ok: true, n: prev.n + 1 }
      : { ok: false, n: prev.n, error: r.error, field: r.field };
  } catch (e) {
    unstable_rethrow(e); // let redirect() (e.g. the app-lock bounce) pass through
    log.error("addSpendAction", "error", { outcome: "error", message: e instanceof Error ? e.message : String(e) });
    return { ok: false, n: prev.n, error: "Couldn't save — please try again." };
  }
}

// The spend's owner can delete their own; the head can delete anyone's.
export async function deleteSpend(formData: FormData) {
  const session = await auth();
  if (!session?.user) return;
  await requireUnlocked("deleteSpend");
  const id = Number(formData.get("id"));
  if (!id) return;
  const spend = await prisma.spend.findUnique({ where: { id } });
  if (!spend) { await logBlocked("deleteSpend", "spend", "not-found", `Delete spend #${id}`); throw new Error("That entry no longer exists — it may already be gone."); }
  if (!(await periodOpen(spend.periodId))) {
    await logBlocked("deleteSpend", "spend", "period-not-open", `Remove “${spend.label}” ${formatINR(spend.amount)}`, spend.periodId);
    throw new Error("This month is closed, so its entries can't be deleted.");
  }

  // The person who LOGGED a spend can remove their own entry even when it's filed under someone else — a
  // spend on a family card is attributed to the card OWNER, not whoever typed it, so an ownership check on
  // memberId alone locked a member out of undoing their own mistake (the bug that hit Arumugam). Head can
  // delete any entry. Silent returns here previously let the UI still toast "deleted" — now we log + throw.
  const meId = session.user.memberId;
  const canDelete = session.user.role === "head" || spend.memberId === meId || spend.loggedById === meId;
  if (!canDelete) {
    await logBlocked("deleteSpend", "spend", "not-logger-or-head", `Remove “${spend.label}” ${formatINR(spend.amount)}`, spend.periodId);
    throw new Error("Only the person who logged this entry (or the head) can delete it.");
  }

  // (Receipt files are deferred/cloud-stored — nothing to unlink locally.)
  // Any credit-dashboard mirror line (family credit-card spend) is removed by the DB cascade
  // (AccountTransaction.familySpendId ON DELETE CASCADE) — no manual cleanup needed here.
  await prisma.spend.delete({ where: { id } });
  await logActivity("spend", "deleted", `Removed spend “${spend.label}” ${formatINR(spend.amount)}`, spend.periodId);
  revalidateFamily();
}

// ── Family Cards (Phase 1) ───────────────────────────────────────────────────────────────────────
// Shared card list reusing FinanceAccount (owner = memberId). Add: any family member. Edit/Delete:
// the card's owner or the head. A card spend is attributed to the owner (see doAddSpend), so the
// owner dropdown is the family member whose cash the card draws.
export type CardFormState = { ok: boolean; error?: string; n: number };

// Validate + parse a credit card's billing-cycle fields from the form. statement day and due-after days
// are required (the dashboard needs them to date the bill); credit limit is optional.
function parseCreditFields(formData: FormData): { statementDay: number; dueOffsetDays: number; creditLimit: number | null } | { error: string } {
  const statementDay = Number(formData.get("statementDay"));
  const dueOffsetDays = Number(formData.get("dueOffsetDays"));
  const limitRaw = String(formData.get("creditLimit") ?? "").trim();
  if (!Number.isInteger(statementDay) || statementDay < 1 || statementDay > 28) return { error: "Statement day must be 1–28." };
  if (!Number.isInteger(dueOffsetDays) || dueOffsetDays < 1 || dueOffsetDays > 60) return { error: "Days until due must be 1–60." };
  const creditLimit = limitRaw ? Number(limitRaw) : null;
  if (creditLimit != null && (!Number.isFinite(creditLimit) || creditLimit < 0)) return { error: "Credit limit looks off." };
  return { statementDay, dueOffsetDays, creditLimit };
}

async function householdMemberIds(): Promise<Set<number>> {
  const hh = await prisma.household.findFirst({ select: { id: true } });
  if (!hh) return new Set();
  const members = await prisma.member.findMany({ where: { householdId: hh.id }, select: { id: true } });
  return new Set(members.map((m) => m.id));
}

export async function addFamilyCard(prev: CardFormState, formData: FormData): Promise<CardFormState> {
  const n = (prev?.n ?? 0) + 1;
  const session = await auth();
  if (!session?.user?.memberId) return { ok: false, error: "Signed out.", n };
  if (!(await unlocked())) return { ok: false, error: "Unlock the app first.", n };
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const ownerId = Number(formData.get("ownerId")) || 0;
  if (!name) return { ok: false, error: "Name the card.", n };
  if (type !== "credit_card" && type !== "debit_card" && type !== "prepaid_card") return { ok: false, error: "Pick a card type.", n };
  if (!(await householdMemberIds()).has(ownerId)) return { ok: false, error: "Pick the card owner.", n };
  // Credit cards carry the billing cycle (statement + due day) so the dashboard can date the bill.
  let credit: { statementDay: number; dueOffsetDays: number; creditLimit: number | null } | null = null;
  if (type === "credit_card") {
    const parsed = parseCreditFields(formData);
    if ("error" in parsed) return { ok: false, error: parsed.error, n };
    credit = parsed;
  }
  // Debit/prepaid carry a starting balance (money already on the card).
  const isBalanceCard = type === "debit_card" || type === "prepaid_card";
  const openingBalance = isBalanceCard ? (Number(String(formData.get("openingBalance") ?? "").replace(/[, ]/g, "")) || 0) : 0;
  const account = await prisma.financeAccount.create({
    data: {
      memberId: ownerId, // the owner — the family member whose cash this card draws
      type,
      name,
      institution: String(formData.get("institution") ?? "").trim() || null,
      network: String(formData.get("network") ?? "").trim() || null,
      last4: String(formData.get("last4") ?? "").trim().slice(0, 4) || null,
      color: String(formData.get("color") ?? "").trim() || "#6366f1",
      openingBalance,
    },
  });
  if (credit) await prisma.creditCardDetail.create({ data: { accountId: account.id, ...credit } });
  await logActivity("spend", "created", `Added card “${name}”`, null);
  revalidateFamily();
  return { ok: true, n };
}

// Owner or head. Owner reassignment (ownerId) is head-only — it only affects FUTURE spends; past
// spends keep their own attribution.
export async function updateFamilyCard(formData: FormData) {
  const session = await auth();
  if (!session?.user?.memberId) return;
  if (!(await unlocked())) return;
  const id = Number(formData.get("id"));
  const account = await prisma.financeAccount.findUnique({ where: { id } });
  if (!account) return;
  const head = await isHead();
  if (!head && account.memberId !== session.user.memberId) return; // owner or head only
  const newOwner = Number(formData.get("ownerId")) || 0;
  const ownerOk = head && newOwner && (await householdMemberIds()).has(newOwner);
  // Billing-cycle edits apply to credit cards only (type can't change on edit). Skip silently if the form
  // omits/misvalidates them so a plain rename never wipes the cycle.
  let credit: { statementDay: number; dueOffsetDays: number; creditLimit: number | null } | null = null;
  if (account.type === "credit_card") {
    const parsed = parseCreditFields(formData);
    if (!("error" in parsed)) credit = parsed;
  }
  // Opening balance is editable for debit/prepaid (a starting-point correction).
  const isBalanceCard = account.type === "debit_card" || account.type === "prepaid_card";
  const openingBalance = isBalanceCard && formData.get("openingBalance") != null
    ? (Number(String(formData.get("openingBalance") ?? "").replace(/[, ]/g, "")) || 0)
    : null;
  await prisma.financeAccount.update({
    where: { id },
    data: {
      name: String(formData.get("name") ?? account.name).trim() || account.name,
      institution: String(formData.get("institution") ?? "").trim() || null,
      network: String(formData.get("network") ?? "").trim() || null,
      last4: String(formData.get("last4") ?? "").trim().slice(0, 4) || null,
      color: String(formData.get("color") ?? "").trim() || account.color,
      active: formData.get("active") == null ? account.active : formData.get("active") === "on",
      ...(ownerOk ? { memberId: newOwner } : {}),
      ...(openingBalance != null ? { openingBalance } : {}),
    },
  });
  if (credit) {
    await prisma.creditCardDetail.upsert({
      where: { accountId: id },
      update: credit,
      create: { accountId: id, ...credit },
    });
  }
  revalidateFamily();
}

export async function deleteFamilyCard(formData: FormData) {
  const session = await auth();
  if (!session?.user?.memberId) return;
  if (!(await unlocked())) return;
  const id = Number(formData.get("id"));
  const account = await prisma.financeAccount.findUnique({ where: { id } });
  if (!account) return;
  if (!(await isHead()) && account.memberId !== session.user.memberId) return; // owner or head only
  await prisma.financeAccount.delete({ where: { id } }); // cascades detail/txns; Spend.cardAccountId → SET NULL
  await logActivity("spend", "deleted", `Removed card “${account.name}”`, null);
  revalidateFamily();
}

// Re-tag a misc spend's reporting sub-category (Food, Travel…). Reporting only — no
// effect on settlement or budgets. Owner or head, on an open month.
export async function setSpendSubCategory(formData: FormData) {
  const session = await auth();
  if (!session?.user) return;
  await requireUnlocked("setSpendSubCategory");
  const id = Number(formData.get("id"));
  const value = String(formData.get("subCategory") ?? "").trim();
  if (!id) return;
  const spend = await prisma.spend.findUnique({ where: { id }, include: { category: { select: { section: true, tracked: true } } } });
  if (!spend) return;
  if (!isMiscBucket(spend.category)) return; // only misc spends carry a sub-category
  if (!(await periodOpen(spend.periodId))) return;

  const isOwner = spend.memberId === session.user.memberId;
  if (session.user.role !== "head" && !isOwner) return;

  const household = await prisma.household.findFirst({ select: { id: true } });
  const valid = household ? (await getMiscSubCategories(household.id)).some((s) => s.name === value) : false;
  await prisma.spend.update({ where: { id }, data: { subCategory: valid ? value : null } });
  revalidateFamily();
}

// ── Head-editable misc sub-categories (reporting tags for family Personal/Misc spends) ───────────
// The built-in defaults live in code; a household starts with none in the DB and falls back to them.
// The first add/remove MATERIALISES the defaults into rows so the head then edits a complete list.
async function ensureMiscSeeded(householdId: number) {
  if ((await prisma.miscCategory.count({ where: { householdId } })) > 0) return;
  await prisma.miscCategory.createMany({
    data: MISC_SUBCATEGORIES.map((s, i) => ({ householdId, name: s.name, icon: s.icon, sortOrder: i })),
    skipDuplicates: true,
  });
}

export async function addMiscCategory(formData: FormData) {
  if (!(await unlocked())) await relock("addMiscCategory");
  if (!(await isHead())) return;
  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  const icon = String(formData.get("icon") ?? "").trim().slice(0, 8) || null;
  if (!name) return;
  const household = await prisma.household.findFirst({ select: { id: true } });
  if (!household) return;
  await ensureMiscSeeded(household.id);
  const max = await prisma.miscCategory.aggregate({ where: { householdId: household.id }, _max: { sortOrder: true } });
  // Keyed on name so re-adding an existing one just updates its icon (idempotent).
  await prisma.miscCategory.upsert({
    where: { householdId_name: { householdId: household.id, name } },
    update: { icon: icon ?? undefined },
    create: { householdId: household.id, name, icon, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  await logActivity("expense", "created", `Added misc category “${name}”`);
  revalidateFamily();
}

// Delete by NAME (not id): before the first edit the UI is showing the in-code defaults, which have no
// row id yet — seeding then deleting by name works whether the item was a default or a custom one.
export async function deleteMiscCategory(formData: FormData) {
  if (!(await unlocked())) await relock("deleteMiscCategory");
  if (!(await isHead())) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const household = await prisma.household.findFirst({ select: { id: true } });
  if (!household) return;
  await ensureMiscSeeded(household.id);
  await prisma.miscCategory.deleteMany({ where: { householdId: household.id, name } });
  await logActivity("expense", "deleted", `Removed misc category “${name}”`);
  revalidateFamily();
}

// Edit a spend in place — same category (card) and same date, just corrected data.
// Head may edit anyone's; the owner may edit their own. Amount/label/(misc) kind, and
// the head can also reassign who spent. Never touches settlement/budget math directly.
export type EditSpendState = { ok: boolean; n: number };
export async function editSpendAction(
  prev: EditSpendState,
  formData: FormData,
): Promise<EditSpendState> {
  const session = await auth();
  if (!session?.user) return prev;
  await requireUnlocked("editSpendAction");
  const id = Number(formData.get("id"));
  const label = String(formData.get("label") ?? "").trim();
  const amount = parseAmount(formData.get("amount"));
  if (!id || !label || !amount) return prev;

  const spend = await prisma.spend.findUnique({ where: { id }, include: { category: { select: { section: true, tracked: true, name: true } } } });
  if (!spend) return prev;
  if (!(await periodOpen(spend.periodId))) return prev;

  const isHead = session.user.role === "head";
  const isOwner = spend.memberId === session.user.memberId;
  if (!isHead && !isOwner) return prev;

  // misc spends must keep a sub-category; non-misc stay null
  const misc = isMiscBucket(spend.category);
  const subRaw = String(formData.get("subCategory") ?? "").trim();
  const household = await prisma.household.findFirst({ select: { id: true } });
  if (misc && !(household && (await getMiscSubCategories(household.id)).some((s) => s.name === subRaw))) return prev;
  const subCategory = misc ? subRaw : null;

  // Payment mode can change on edit: cash/UPI or a family card. A valid card re-attributes the spend to
  // its OWNER (regardless of who logged it); the field is only present when the household has cards.
  let cardAccountId: number | null = null;
  let cardOwnerId: number | null = null;
  const rawCard = Number(formData.get("cardAccountId")) || 0;
  if (rawCard) {
    const card = await prisma.financeAccount.findUnique({ where: { id: rawCard }, select: { memberId: true, active: true, member: { select: { householdId: true } } } });
    if (card && card.active && household && card.member.householdId === household.id) {
      cardAccountId = rawCard;
      cardOwnerId = card.memberId;
    }
  }

  // Attribution: a card spend is always the card OWNER's. Cash: the head may reassign who spent
  // (incl. "Shared" = null); otherwise keep the existing attribution.
  let memberId = spend.memberId;
  if (cardAccountId != null) {
    memberId = cardOwnerId;
  } else if (isHead && formData.has("memberId")) {
    const raw = String(formData.get("memberId") ?? "");
    memberId = raw === "" ? null : Number(raw) || null;
  }

  // createdAt is intentionally left untouched — the date of spend stays as it was.
  await prisma.spend.update({ where: { id }, data: { label, amount, subCategory, memberId, cardAccountId } });
  // Re-sync the card-ledger mirror (see doAddSpend). On a card now → upsert on that card/owner; moved to
  // cash or to a different card → the upsert re-points it, and switching to cash removes it entirely.
  if (cardAccountId != null && cardOwnerId != null) {
    await prisma.accountTransaction.upsert({
      where: { familySpendId: id },
      // category drives the card-bill budgeted-vs-misc split (getCardDues) — a spend re-tagged to a card
      // via edit must carry its category name too, or it wrongly reads as "misc" on the bill. Backfills
      // the field on update so any earlier mirror that missed it is repaired the next time it's edited.
      update: { amount, merchant: label, accountId: cardAccountId, memberId: cardOwnerId, category: spend.category?.name ?? null },
      create: { memberId: cardOwnerId, accountId: cardAccountId, date: spend.createdAt, merchant: label, amount, type: "spend", category: spend.category?.name ?? null, source: "family", familySpendId: id },
    });
  } else {
    await prisma.accountTransaction.deleteMany({ where: { familySpendId: id } });
  }
  await logActivity("spend", "updated", `Edited spend “${label}” ${formatINR(amount)}`, spend.periodId);
  revalidateFamily();
  return { ok: true, n: prev.n + 1 };
}

// ── Family credit-card bill: one owner-only payment settles the whole cycle ──────────────────────
// A family card bill combines family spends (funded from the owner's held budget / in-hand) + the
// owner's own personal spends (from their Can-spend) + any annual fee — but it's ONE real payment.
// Settling writes a single PersonalCardBill (keyed by card + cycleEnd), which BOTH the family plan
// (getPendingCardBills) and the personal dashboard (getCardDues) read to drop the cycle as paid. The
// amount is what was actually paid (editable in the modal, default = swipes + annual fee); the ±
// difference vs the summed swipes is derived later for the card's profit/loss. SECURITY: only the
// card's OWNER may pay — enforced here, not just hidden in the UI.
export async function payFamilyCardBill(formData: FormData) {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Signed out." };
  const selfId = session.user.memberId ?? null;
  const cardAccountId = Number(formData.get("cardId")) || 0;
  const cycleEndISO = String(formData.get("cycleEnd") ?? "");
  const amount = parseAmount(formData.get("amount"));
  if (!cardAccountId || !cycleEndISO || amount == null || amount < 0) return { ok: false, error: "Bad input." };
  const card = await prisma.financeAccount.findUnique({ where: { id: cardAccountId }, select: { memberId: true, type: true, name: true } });
  if (!card || card.type !== "credit_card") return { ok: false, error: "Not a credit card." };
  if (card.memberId !== selfId) { log.warn("payFamilyCardBill", "blocked", { outcome: "blocked", reason: "not-owner", selfId, cardAccountId }); return { ok: false, error: "Only the card owner can pay this bill." }; }
  const cycleEnd = new Date(cycleEndISO);
  if (isNaN(cycleEnd.getTime())) return { ok: false, error: "Bad cycle." };
  // Recompute the cycle's expected total server-side (never trust the client): family + personal swipes
  // + any annual fee. The ± difference vs what was actually paid is the card's cashback (−) or fee (+),
  // recorded on the card ledger so each card's profit/loss is visible in the personal Finance section.
  const dues = await getCardDues(card.memberId);
  const cyc = dues.find((d) => d.cardId === cardAccountId)?.cycles.find((c) => Math.abs(new Date(c.cycleEndISO).getTime() - cycleEnd.getTime()) < 86400000);
  const expected = cyc ? Math.round((cyc.total + cyc.familyTotal + cyc.annualFee) * 100) / 100 : amount;
  const difference = Math.round((amount - expected) * 100) / 100; // + = extra fees/charges, − = cashback/savings
  const diffMarker = `__cardbilldiff__:${cycleEnd.toISOString()}`;
  // The payment leaves cash in the OWNER's current personal month (mirrors the personal markCardBillPaid).
  const period = await ensurePersonalMonth(card.memberId);
  await prisma.$transaction(async (tx) => {
    await tx.personalCardBill.upsert({
      where: { cardAccountId_cycleEnd: { cardAccountId, cycleEnd } },
      create: { memberId: card.memberId, cardAccountId, cycleEnd, paidPeriodId: period.id, amount },
      update: { amount, paidPeriodId: period.id, paidAt: new Date() },
    });
    // Replace any prior difference row for this cycle (re-paying with a new amount re-derives it).
    await tx.accountTransaction.deleteMany({ where: { accountId: cardAccountId, category: diffMarker } });
    if (Math.abs(difference) > 0.005) {
      await tx.accountTransaction.create({
        data: {
          memberId: card.memberId, accountId: cardAccountId, date: new Date(),
          merchant: difference < 0 ? "Bill savings / cashback" : "Bill fees / charges",
          amount: Math.abs(difference),
          type: difference < 0 ? "cashback" : "fee",
          category: diffMarker, source: "manual",
        },
      });
    }
  });
  log.info("payFamilyCardBill", "ok", { outcome: "ok", cardAccountId, amount, difference });
  revalidateFamily();
  revalidatePath("/personal", "layout");
  return { ok: true };
}

// Undo a family card-bill payment — deletes the settle record so the cycle reappears as unpaid on both
// the family plan and the personal dashboard. Owner-only, same as paying.
export async function unpayFamilyCardBill(formData: FormData) {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Signed out." };
  const selfId = session.user.memberId ?? null;
  const cardAccountId = Number(formData.get("cardId")) || 0;
  const cycleEndISO = String(formData.get("cycleEnd") ?? "");
  if (!cardAccountId || !cycleEndISO) return { ok: false, error: "Bad input." };
  const card = await prisma.financeAccount.findUnique({ where: { id: cardAccountId }, select: { memberId: true } });
  if (!card || card.memberId !== selfId) { log.warn("unpayFamilyCardBill", "blocked", { outcome: "blocked", reason: "not-owner", selfId, cardAccountId }); return { ok: false, error: "Only the card owner can undo this." }; }
  const cycleEnd = new Date(cycleEndISO);
  if (isNaN(cycleEnd.getTime())) return { ok: false, error: "Bad cycle." };
  const diffMarker = `__cardbilldiff__:${cycleEnd.toISOString()}`;
  await prisma.$transaction([
    prisma.personalCardBill.deleteMany({ where: { cardAccountId, cycleEnd } }),
    prisma.accountTransaction.deleteMany({ where: { accountId: cardAccountId, category: diffMarker } }),
  ]);
  log.info("unpayFamilyCardBill", "ok", { outcome: "ok", cardAccountId });
  revalidateFamily();
  revalidatePath("/personal", "layout");
  return { ok: true };
}

// Use Piggy money: reduce a Piggy/sinking bucket and add the amount as a ONE-OFF
// income to the chosen month. No forced expense — the household then spends it
// from any category via the normal add-spend/add-expense flow (the added income
// raises the month balance, which the expense guard uses to permit those spends).
// oneOff:true so the piggy income never clones into future months.
export async function withdrawPiggy(formData: FormData) {
  if (!(await isHead())) return;
  const periodId = Number(formData.get("periodId"));
  const amount = parseAmount(formData.get("amount"));
  const source = String(formData.get("source") ?? "general"); // "general" | categoryId
  const note = String(formData.get("note") ?? "").trim() || "Piggy use";
  if (!periodId || !amount || amount <= 0) return;

  const household = await prisma.household.findFirst();
  if (!household) return;
  const sinkingCatId = source !== "general" ? Number(source) : null;

  // Overdraw guard: never let a withdrawal exceed the available balance.
  const avail = await prisma.piggyEntry.aggregate({
    where: sinkingCatId
      ? { householdId: household.id, kind: "sinking", categoryId: sinkingCatId }
      : { householdId: household.id, kind: "piggy" },
    _sum: { amount: true },
  });
  if (Math.abs(amount) > (avail._sum.amount ?? 0)) return; // blocked (UI also guards)

  await prisma.$transaction(async (tx) => {
    // 1. reduce the piggy/sinking bucket
    await tx.piggyEntry.create({
      data: {
        householdId: household.id,
        periodId,
        categoryId: sinkingCatId,
        kind: sinkingCatId ? "sinking" : "piggy",
        amount: -Math.abs(amount),
        note: `Withdrawal: ${note}`,
      },
    });
    // 2. one-off income line (money brought into the month; not copied forward). A GENERAL-Piggy use
    // carries the marker note so its "holder → treasurer" hand-over can be re-derived; a sinking-fund
    // withdrawal is held by the fund's saver, not the Piggy holder, so it's left unmarked.
    await tx.incomeEntry.create({
      data: { periodId, source: `From Piggy: ${note}`, amount, oneOff: true, note: sinkingCatId ? null : PIGGY_INCOME_NOTE },
    });
  });
  if (!sinkingCatId) await syncPiggyHandover(household.id, periodId);
  await logActivity("piggy", "updated", `Used Piggy ${formatINR(amount)} — ${note}`, periodId);
  revalidateFamily();
}

// Keep the "general Piggy taken as income" hand-over (PoolHandover kind "piggy") in sync with the
// marked income lines: the Piggy holder physically holds that cash until they hand it to the treasurer.
// Re-derived from the marked lines so it self-corrects when one is added OR deleted. A no-op amount, or
// a Piggy holder who IS the treasurer, clears the row (cash already at the hub).
async function syncPiggyHandover(householdId: number, periodId: number) {
  const [household, period, head] = await Promise.all([
    prisma.household.findUnique({ where: { id: householdId }, select: { treasurerMemberId: true, piggyHolderMemberId: true } }),
    prisma.period.findUnique({ where: { id: periodId }, select: { treasurerMemberId: true } }),
    prisma.member.findFirst({ where: { householdId, role: "head" }, select: { id: true } }),
  ]);
  const treasurerId = period?.treasurerMemberId ?? household?.treasurerMemberId ?? head?.id ?? null;
  const holderId = household?.piggyHolderMemberId ?? head?.id ?? null;
  const agg = await prisma.incomeEntry.aggregate({ where: { periodId, note: PIGGY_INCOME_NOTE }, _sum: { amount: true } });
  const total = Math.round((agg._sum.amount ?? 0) * 100) / 100;
  if (holderId == null || holderId === treasurerId || total <= 0.005) {
    if (holderId != null) await prisma.poolHandover.deleteMany({ where: { periodId, fromMemberId: holderId, kind: "piggy" } });
    return;
  }
  await prisma.poolHandover.upsert({
    where: { periodId_fromMemberId_kind: { periodId, fromMemberId: holderId, kind: "piggy" } },
    create: { periodId, householdId, fromMemberId: holderId, kind: "piggy", amount: total, detail: null },
    update: { amount: total },
  });
}

// Head adjusts the general Piggy or a sinking fund (e.g. a manual top-up). Head-only, so a
// NEGATIVE amount is allowed too — a manual deduction/correction (records as a withdrawal entry).
export async function depositPiggy(formData: FormData) {
  if (!(await isHead())) return;
  const amount = parseAmount(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim() || "Manual adjustment";
  // target = "general" (general Piggy) or a sinking-fund categoryId
  const target = String(formData.get("target") ?? "general");
  if (!amount || Number.isNaN(amount) || amount === 0) return; // any non-zero amount (± for head)
  const household = await prisma.household.findFirst();
  if (!household) return;
  const sinkingCatId = target !== "general" ? Number(target) : null;
  await prisma.piggyEntry.create({
    data: {
      householdId: household.id,
      categoryId: sinkingCatId,
      kind: sinkingCatId ? "sinking" : "piggy",
      amount, // signed — negative = a manual deduction/correction
      note: `${amount < 0 ? "Adjustment" : "Deposit"}: ${note}`,
    },
  });
  await logActivity(
    "piggy",
    "created",
    `${amount < 0 ? "Removed" : "Added"} ${formatINR(Math.abs(amount))} ${amount < 0 ? "from" : "to"} Piggy — ${note}`,
  );
  revalidateFamily();
}

// Head sets a fund's CURRENT balance to an exact amount — records the difference
// as an "Adjustment" entry so the history stays intact. target = general | catId.
export async function setFundBalance(formData: FormData) {
  if (!(await isHead())) return;
  const targetAmount = parseAmount(formData.get("amount"));
  const target = String(formData.get("target") ?? "general");
  if (Number.isNaN(targetAmount)) return;
  const household = await prisma.household.findFirst();
  if (!household) return;
  const sinkingCatId = target !== "general" ? Number(target) : null;
  const agg = await prisma.piggyEntry.aggregate({
    where: sinkingCatId
      ? { householdId: household.id, kind: "sinking", categoryId: sinkingCatId }
      : { householdId: household.id, kind: "piggy" },
    _sum: { amount: true },
  });
  const current = agg._sum.amount ?? 0;
  const delta = targetAmount - current;
  if (Math.abs(delta) < 0.005) return; // already at target
  await prisma.piggyEntry.create({
    data: {
      householdId: household.id,
      categoryId: sinkingCatId,
      kind: sinkingCatId ? "sinking" : "piggy",
      amount: delta,
      note: `Adjustment (set to ₹${Math.round(targetAmount).toLocaleString("en-IN")})`,
    },
  });
  await logActivity("piggy", "updated", `Set a fund balance to ${formatINR(targetAmount)}`);
  revalidateFamily();
}

// Add a new recurring/tracked category (Setup screen). useActionState-shaped.
export type CreateCategoryState = { ok: boolean; error?: string; n: number };

// Skip a bill-with-a-fund's set-aside for a single month (head/manager). Removes the
// set-aside line from that month's sheet (frees the money) and records the skip so it's
// not re-added on a rebuild and not accrued at wind-down. The remaining months recompute
// higher on their own (the fund is short).
export async function skipSetAside(formData: FormData) {
  if (!(await canEdit())) return;
  const categoryId = Number(formData.get("categoryId"));
  const periodId = Number(formData.get("periodId"));
  if (!categoryId || !periodId || !(await canEditNow(periodId))) return;
  const cat = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!cat || cat.fundingStyle == null) return;
  const period = await prisma.period.findUnique({ where: { id: periodId }, select: { householdId: true } });
  if (!period) return;
  await prisma.$transaction(async (tx) => {
    await tx.setAsideSkip.upsert({
      where: { categoryId_periodId: { categoryId, periodId } },
      create: { householdId: period.householdId, categoryId, periodId },
      update: {},
    });
    await tx.expenseEntry.deleteMany({ where: { periodId, categoryId, OR: [{ label: { endsWith: "(saving)" } }, { label: { endsWith: "(monthly share)" } }] } });
  });
  await logActivity("expense", "updated", `Skipped this month's set-aside for “${cat.name}”`, periodId);
  revalidateFamily();
}

// Undo a skip — put the set-aside back on the sheet (recomputed from the current fund).
export async function restoreSetAside(formData: FormData) {
  if (!(await canEdit())) return;
  const categoryId = Number(formData.get("categoryId"));
  const periodId = Number(formData.get("periodId"));
  if (!categoryId || !periodId || !(await canEditNow(periodId))) return;
  const [cat, period, fundAgg] = await Promise.all([
    prisma.category.findUnique({ where: { id: categoryId } }),
    prisma.period.findUnique({ where: { id: periodId }, select: { month: true } }),
    prisma.piggyEntry.aggregate({ where: { categoryId, kind: "sinking" }, _sum: { amount: true } }),
  ]);
  if (!cat || cat.fundingStyle == null || !period || cat.billAmount == null || cat.billMonth == null || cat.billEveryMonths == null) return;
  const plan = planBillMonth({
    billAmount: cat.billAmount, billMonth: cat.billMonth, everyMonths: cat.billEveryMonths,
    fund: fundAgg._sum.amount ?? 0, fundingStyle: cat.fundingStyle as FundingStyle, fixedShare: cat.monthlyBudget, saveEveryMonths: cat.saveEveryMonths, month: period.month,
  });
  await prisma.$transaction(async (tx) => {
    await tx.setAsideSkip.deleteMany({ where: { categoryId, periodId } });
    await tx.expenseEntry.deleteMany({ where: { periodId, categoryId, OR: [{ label: { endsWith: "(saving)" } }, { label: { endsWith: "(monthly share)" } }] } });
    if (plan.kind === "save" && plan.contribution > 0) {
      await tx.expenseEntry.create({ data: { periodId, label: `${cat.name} (monthly share)`, amount: plan.contribution, categoryId, memberId: cat.responsibleMemberId, necessary: cat.necessary ?? true, oneOff: false } });
    }
  });
  await logActivity("expense", "updated", `Restored the set-aside for “${cat.name}”`, periodId);
  revalidateFamily();
}

const CATEGORY_SECTIONS = ["Loans", "Chits", "Monthly", "Yearly", "Misc"] as const;

// The billing shape of a category from the Setup form. Unified model: the billing CYCLE
// (`billEveryMonths`; 1 = monthly) drives everything. Monthly → a monthly budget/fixed bill;
// any longer cycle → a periodic bill funded by saving the share (auto, on a chosen cadence)
// or paying in full at the due month. Every field not relevant to the choice is cleared, so
// switching cycles never leaves stale config behind. (Legacy `sinking`/`cycleMonths` are
// always blanked — rolling sinking funds were folded into the periodic model.)
type BillingFields = {
  monthlyBudget: number | null; sinking: boolean; cycleMonths: number | null; fixed: boolean; tracked: boolean;
  billEveryMonths: number | null; billMonth: number | null; billDay: number | null; billAmount: number | null;
  fundingStyle: string | null; saveEveryMonths: number | null; onUnpaid: string;
};
type Getter = (k: string) => string | null;
function parseBilling(get: Getter): { ok: true; fields: BillingFields } | { ok: false; error: string } {
  const blank: BillingFields = { monthlyBudget: null, sinking: false, cycleMonths: null, fixed: false, tracked: false, billEveryMonths: null, billMonth: null, billDay: null, billAmount: null, fundingStyle: null, saveEveryMonths: null, onUnpaid: "carry" };
  const round = (x: number) => Math.round(x * 100) / 100;
  const onUnpaidOf = () => (get("onUnpaid") === "skip" ? "skip" : "carry");
  const cycle = Math.max(1, Math.round(Number(get("billEveryMonths")) || 1));
  const billDayOf = () => { const d = Number(get("billDay")); return d >= 1 && d <= 31 ? d : null; };
  const monthOf = () => Math.min(12, Math.max(1, Number(get("billMonth")) || 1));

  // Monthly (cycle 1): a "save the share" bill paid via In-Hand every month (billEveryMonths=1),
  // OR a variable budget (tracked, leftover → Piggy), OR a flat fixed bill.
  if (cycle <= 1) {
    // Monthly bill-with-a-fund: signalled by a non-empty fundingStyle on a monthly row.
    if (String(get("fundingStyle") ?? "") === "auto") {
      const amt = parseAmount(get("billAmount"));
      if (!amt || amt <= 0) return { ok: false, error: "A monthly bill needs an amount." };
      return { ok: true, fields: { ...blank, tracked: false, billEveryMonths: 1, billMonth: monthOf(), billDay: billDayOf(), billAmount: round(amt), fundingStyle: "auto", saveEveryMonths: 1, onUnpaid: onUnpaidOf() } };
    }
    const fixed = get("fixed") === "on";
    const raw = String(get("monthlyBudget") ?? "").trim();
    const amt = raw === "" ? null : parseAmount(raw);
    if (fixed && (!amt || amt <= 0)) return { ok: false, error: "A fixed bill needs a monthly amount." };
    return { ok: true, fields: { ...blank, fixed, tracked: !fixed, monthlyBudget: amt != null ? round(amt) : null } };
  }

  // Periodic bill (cycle 2/3/4/6/12): full amount + due month + funding.
  if (![2, 3, 4, 6, 12].includes(cycle)) return { ok: false, error: "Pick a valid billing cycle." };
  const amt = parseAmount(get("billAmount"));
  if (!amt || amt <= 0) return { ok: false, error: "A periodic bill needs an amount." };
  const style = String(get("fundingStyle") ?? "auto");
  const fundingStyle = style === "none" ? "none" : "auto"; // save the share, or pay in full
  let saveEveryMonths: number | null = null;
  if (fundingStyle === "auto") {
    const s = Math.max(1, Math.round(Number(get("saveEveryMonths")) || 1));
    if (cycle % s !== 0) return { ok: false, error: "Save cadence must divide the billing cycle." };
    saveEveryMonths = s;
  }
  return { ok: true, fields: { ...blank, tracked: false, billEveryMonths: cycle, billMonth: monthOf(), billDay: billDayOf(), billAmount: round(amt), fundingStyle, saveEveryMonths, onUnpaid: fundingStyle === "auto" ? onUnpaidOf() : "carry" } };
}
function parseBillingFields(formData: FormData) {
  return parseBilling((k) => { const v = formData.get(k); return v == null ? null : String(v); });
}

export async function createCategory(
  prev: CreateCategoryState,
  formData: FormData,
): Promise<CreateCategoryState> {
  const n = (prev?.n ?? 0) + 1;
  if (!(await isHead())) return { ok: false, error: "Only the head can add categories.", n };
  const householdId = Number(formData.get("householdId"));
  const name = String(formData.get("name") ?? "").trim();
  if (!householdId || !name) return { ok: false, error: "Give the category a name.", n };
  const billing = parseBillingFields(formData);
  if (!billing.ok) return { ok: false, error: billing.error, n };
  const paidByRaw = String(formData.get("responsibleMemberId") ?? "").trim();
  const responsibleMemberId = paidByRaw === "" ? null : Number(paidByRaw);
  const payerRaw = String(formData.get("payerMemberId") ?? "").trim();
  const payerMemberId = payerRaw === "" ? null : Number(payerRaw);
  const sectionRaw = String(formData.get("section") ?? "").trim();
  const section = (CATEGORY_SECTIONS as readonly string[]).includes(sectionRaw) ? sectionRaw : "Monthly";

  try {
    await prisma.category.create({
      data: { householdId, name, section, responsibleMemberId, payerMemberId, ...billing.fields },
    });
  } catch {
    return { ok: false, error: `"${name}" already exists.`, n };
  }
  // Setup is the template for FUTURE months — it does not touch the current sheet.
  // From next month, clonePeriodInto turns this category into a tagged Sheet line.
  revalidateFamily();
  return { ok: true, n };
}

// Planned-misc spend card: create a budgeted (tracked, leftover→Piggy) category for THIS month
// and materialise its envelope now — members then log spends into it like veggies/fuel, with the
// usual payment-method + out-of-pocket → settlement, remaining → Piggy, overspend → carry. One-off
// by default (never cloned forward); repeatYearly re-seeds it in this month each year (see
// periodClone). Distinct from the ad-hoc Misc SPENDS, which are untouched.
// Core: create the card + materialise its envelope. Shared by the standalone action and the
// ExpenseModal's "make it a spend card" branch (which sends `label` for the name). Assumes the
// caller already checked canEdit/canEditNow.
async function doAddMiscSpendCard(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const periodId = Number(formData.get("periodId"));
  const name = String(formData.get("name") ?? formData.get("label") ?? "").trim().slice(0, 40);
  const amount = parseAmount(formData.get("amount"));
  if (!periodId || !name || !amount || amount <= 0) return { ok: false, error: "Give the card a name and budget." };
  const repeatMonthly = formData.get("repeatMonthly") === "on";
  const repeatYearly = !repeatMonthly && formData.get("repeatYearly") === "on"; // monthly supersedes yearly
  const memberRaw = String(formData.get("responsibleMemberId") ?? formData.get("memberId") ?? "").trim();
  const responsibleMemberId = memberRaw === "" ? null : Number(memberRaw);
  // Optional due day — the card shows as a dated bill in the Money Plan (assume the owner spends it all).
  const dueNum = Number(String(formData.get("dueDay") ?? "").trim());
  const dueDay = Number.isFinite(dueNum) && dueNum >= 1 && dueNum <= 31 ? Math.round(dueNum) : null;
  const period = await prisma.period.findUnique({ where: { id: periodId }, select: { householdId: true, month: true } });
  if (!period) return { ok: false, error: "Month not found." };
  // Same balance guard as adding an expense: the budget can't exceed the month's income − expense.
  const [inc, exp] = await Promise.all([
    prisma.incomeEntry.aggregate({ where: { periodId }, _sum: { amount: true } }),
    prisma.expenseEntry.aggregate({ where: { periodId }, _sum: { amount: true } }),
  ]);
  const bal = (inc._sum.amount ?? 0) - (exp._sum.amount ?? 0);
  if (amount > bal) return { ok: false, error: `That's more than the month's balance (${formatINR(bal)}).` };
  try {
    await prisma.$transaction(async (tx) => {
      // section "Monthly" + tracked (+ no sinking/fund/periodic) = a "Budgeted · leftover → Piggy"
      // card, exactly like veggies/fuel — so it renders and settles like them with no misc-bucket
      // special-casing. `miscCard` only tags it (clone gating + Setup); it never keys misc behaviour.
      const cat = await tx.category.create({
        data: {
          householdId: period.householdId, name, section: "Monthly", tracked: true,
          monthlyBudget: amount, responsibleMemberId, miscCard: true, repeatMonthly, repeatYearly, billMonth: repeatYearly ? period.month : null,
        },
      });
      // Materialise into the CURRENT month now (clone only seeds FUTURE months): envelope + budget,
      // both, so the amount stays in sync (Sheet renders the envelope, spends draw the Budget).
      // pinned=true so a draft rebuild (clearGeneratedRows) keeps the line AND its budget — the clone
      // won't regenerate a one-off misc card, so without the pin a rebuild would wipe the whole card.
      await tx.expenseEntry.create({ data: { periodId, label: name, amount, categoryId: cat.id, memberId: responsibleMemberId, necessary: true, oneOff: false, pinned: true, dueDay } });
      await tx.budget.create({ data: { periodId, categoryId: cat.id, planned: amount } });
    });
  } catch {
    return { ok: false, error: `"${name}" already exists.` };
  }
  await logActivity("expense", "created", `Added misc spend card “${name}” (${formatINR(amount)})${repeatMonthly ? " · repeats monthly" : repeatYearly ? " · repeats yearly" : ""}`, periodId);
  revalidateFamily();
  return { ok: true };
}

// Setup control: stop a misc spend card from re-seeding (monthly or yearly). Keeps the current
// month's card (it has spends/an envelope) — just clears the repeat so it won't come back.
export async function stopMiscCardRepeat(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("categoryId"));
  if (!id) return;
  const cat = await prisma.category.findUnique({ where: { id }, select: { miscCard: true, name: true } });
  if (!cat?.miscCard) return;
  await prisma.category.update({ where: { id }, data: { repeatYearly: false, repeatMonthly: false } });
  await logActivity("expense", "updated", `Stopped misc card “${cat.name}” repeating`);
  revalidateFamily();
}

export type MiscCardState = { ok: boolean; n: number; error?: string };
export async function addMiscSpendCard(prev: MiscCardState, formData: FormData): Promise<MiscCardState> {
  const n = (prev?.n ?? 0) + 1;
  const periodId = Number(formData.get("periodId"));
  if (!periodId || !(await canEditNow(periodId))) return { ok: false, n, error: "This month can’t be edited." };
  const res = await doAddMiscSpendCard(formData);
  return { ok: res.ok, n: res.ok ? n : n, error: res.error };
}

// Delete a category — only if it has no expense rows (else suggest Hold). Cleans budgets/spends.
export async function deleteCategory(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("categoryId"));
  if (!id) return;
  const used = await prisma.expenseEntry.count({ where: { categoryId: id } });
  if (used > 0) return; // can't delete a category with sheet history — use Hold
  await prisma.$transaction([
    prisma.spend.deleteMany({ where: { categoryId: id } }),
    prisma.budget.deleteMany({ where: { categoryId: id } }),
    prisma.piggyEntry.deleteMany({ where: { categoryId: id } }),
    prisma.category.delete({ where: { id } }),
  ]);
  revalidateFamily();
}

// Pause / resume a category (skipped from new-month seeding & wind-down while held).
export async function toggleHold(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("categoryId"));
  if (!id) return;
  const cat = await prisma.category.findUnique({ where: { id } });
  if (!cat) return;
  await prisma.category.update({ where: { id }, data: { onHold: !cat.onHold } });
  revalidateFamily();
}

// Per-bill reminder toggle: mute/unmute the due popup for one bill (head-only).
export async function toggleRemind(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("categoryId"));
  if (!id) return;
  const cat = await prisma.category.findUnique({ where: { id }, select: { remind: true } });
  if (!cat) return;
  await prisma.category.update({ where: { id }, data: { remind: !cat.remind } });
  revalidateFamily();
}

// Per-bill reminder settings (from the row's popup): notify on/off + how many days before due.
export async function setBillReminderConfig(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("categoryId"));
  if (!id) return;
  const remind = String(formData.get("remind")) === "on";
  const rawDays = formData.get("reminderDays");
  const n = rawDays == null || String(rawDays).trim() === "" ? null : Number(rawDays);
  const reminderDays = n == null || Number.isNaN(n) ? null : Math.min(30, Math.max(0, Math.round(n)));
  await prisma.category.update({ where: { id }, data: { remind, reminderDays } });
  revalidateFamily();
}

// Shared family note: ANY signed-in member may edit it (deliberately not head-gated) — it's
// a common scratch pad. Still protected by the household app-lock like everything else.
export type NoteState = { ok: boolean; n: number };
export async function saveFamilyNote(prev: NoteState, formData: FormData): Promise<NoteState> {
  const session = await auth();
  if (!session?.user) return { ok: false, n: prev.n };
  await requireUnlocked("saveFamilyNote");
  const household = await prisma.household.findFirst({ select: { id: true } });
  if (!household) return { ok: false, n: prev.n };
  const raw = String(formData.get("notes") ?? "");
  const notes = raw.slice(0, 20000); // generous cap; it's a note, not a document store
  await prisma.household.update({
    where: { id: household.id },
    data: { notes, notesUpdatedAt: new Date(), notesUpdatedById: session.user.memberId ?? null },
  });
  revalidatePath("/notes");
  return { ok: true, n: prev.n + 1 };
}

// Master switch for bill-due reminders (head-only) — Settings.
export async function setBillReminders(formData: FormData) {
  if (!(await isHead())) return;
  const on = String(formData.get("on")) === "on";
  const household = await prisma.household.findFirst({ select: { id: true } });
  if (!household) return;
  await prisma.household.update({ where: { id: household.id }, data: { billRemindersOn: on } });
  revalidateFamily();
}

// The bill-due reminders relevant to the signed-in member (they're the responsible/paying
// member, or the head/a manager). Powers the once-a-day high-alert popup. Amounts included —
// the household already sees bill figures in the sheet.
export type MyBillReminder = { categoryId: number; name: string; dueISO: string; daysUntilDue: number; overdue: boolean; amount: number | null };
export async function getMyBillReminders(): Promise<MyBillReminder[]> {
  const session = await auth();
  if (!session?.user) return [];
  const household = await prisma.household.findFirst({ select: { id: true } });
  if (!household) return [];
  const email = session.user.email?.toLowerCase();
  const member =
    (session.user.memberId ? await prisma.member.findUnique({ where: { id: session.user.memberId }, select: { id: true } }) : null) ??
    (email ? await prisma.member.findFirst({ where: { householdId: household.id, email }, select: { id: true } }) : null);
  if (!member) return [];
  const reminders = await getBillReminders(household.id);
  return reminders
    .filter((r) => r.recipientIds.includes(member.id))
    .map((r) => ({ categoryId: r.categoryId, name: r.name, dueISO: r.dueISO, daysUntilDue: r.daysUntilDue, overdue: r.overdue, amount: r.amount }));
}

export type MyDueStep = { label: string; amount: number; overdue: boolean };
// The current member's OWN Money-plan steps that need action NOW in the working (earliest-open)
// month — i.e. they're the actor (bill payer / transfer sender / allowance sender) and the step is
// unpaid and either overdue or due today. Powers the dismissible due-today banner in the header.
export async function getMyDueTodaySteps(): Promise<{ periodQ: string; steps: MyDueStep[] }> {
  const empty = { periodQ: "", steps: [] as MyDueStep[] };
  const session = await auth();
  if (!session?.user) return empty;
  const household = await prisma.household.findFirst({ select: { id: true } });
  if (!household) return empty;
  const email = session.user.email?.toLowerCase();
  const member =
    (session.user.memberId ? await prisma.member.findUnique({ where: { id: session.user.memberId }, select: { id: true } }) : null) ??
    (email ? await prisma.member.findFirst({ where: { householdId: household.id, email }, select: { id: true } }) : null);
  if (!member) return empty;
  const working = await prisma.period.findFirst({ where: { householdId: household.id, status: "open" }, orderBy: [{ year: "asc" }, { month: "asc" }], select: { id: true, year: true, month: true } });
  if (!working) return empty;
  const plan = await getMoneyPlan(household.id, working.id);
  const mine = plan.steps.filter(
    (s) =>
      !s.done &&
      (s.status === "overdue" || (s.status === "soon" && (s.days ?? 1) <= 0)) &&
      // the ACTOR: the bill's payer, or a transfer/allowance sender (never the mere recipient)
      (s.payerId === member.id || s.fromId === member.id),
  );
  const steps = mine.map((s) => ({
    label: s.kind === "allowance" ? `Personal expense → ${s.toName}` : s.kind !== "bill" ? `${s.fromName} → ${s.toName}` : `${s.payerName} → ${s.vendor}`,
    amount: s.amount,
    overdue: s.status === "overdue",
  }));
  return { periodQ: `?y=${working.year}&m=${working.month}`, steps };
}

// Choose the treasurer/hub that everyone settles with (head-only).
export async function setTreasurer(formData: FormData) {
  if (!(await isHead())) return;
  const householdId = Number(formData.get("householdId"));
  const periodId = formData.get("periodId") ? Number(formData.get("periodId")) : null;
  const memberId = formData.get("treasurerMemberId")
    ? Number(formData.get("treasurerMemberId"))
    : null;
  // When a periodId is given, set the per-month hub override; else the household default.
  if (periodId) {
    await prisma.period.update({
      where: { id: periodId },
      data: { treasurerMemberId: memberId },
    });
  } else if (householdId) {
    await prisma.household.update({
      where: { id: householdId },
      data: { treasurerMemberId: memberId },
    });
  } else {
    return;
  }
  revalidateFamily();
}

// Mark / unmark a bill as paid — head/manager, on an open month. A paid bill drops out
// of "budget left in hand" (that cash went out) and into the "Paid this month" list.
export async function toggleBillPaid(formData: FormData) {
  const session = await auth();
  const memberId = session?.user?.memberId ?? null;
  if (!(await unlocked())) await relock("toggleBillPaid");
  const id = Number(formData.get("id"));
  const e = await prisma.expenseEntry.findUnique({ where: { id }, include: { category: { select: { isAllowance: true, householdId: true } } } });
  if (!e) { log.warn("toggleBillPaid", "blocked", { outcome: "blocked", reason: "not-found", memberId, id }); return; }
  // Marking a bill paid TRACKS REALITY — it doesn't change the planned sheet, so the settlement lock
  // (which freezes planned numbers) must NOT apply here. Authorization goes through the SHARED
  // canActOnStep the UI uses, so button and enforcement can't drift. A HUB-DISBURSED line is paid/sent
  // by the TREASURER, not whoever it's stored against — an allowance ("personal · from hub", stored
  // against the recipient), pool-funded misc (note=__pool__, a plain Misc category), or a shared/pool
  // bill (memberId null, paid from the pool). We map all bill/allowance/pool ticks to the same "bill"
  // decision: payer = the stored member, plus the treasurer via `hubLine`. Resolve the treasurer only
  // when it could actually unblock (non-editor, non-payer, and a hub line).
  const isEditor = await canEdit(); // head or manager (and unlocked)
  const isPayer = memberId != null && memberId === e.memberId;
  const isHubLine = !!e.category?.isAllowance || isPoolNote(e.note) || e.memberId == null;
  let treasurerId: number | null = null;
  if (!isEditor && !isPayer && isHubLine && memberId != null) {
    const [period, household, headMember] = await Promise.all([
      prisma.period.findUnique({ where: { id: e.periodId }, select: { treasurerMemberId: true } }),
      prisma.household.findUnique({ where: { id: e.category.householdId }, select: { treasurerMemberId: true } }),
      prisma.member.findFirst({ where: { householdId: e.category.householdId, role: "head" }, select: { id: true } }),
    ]);
    treasurerId = period?.treasurerMemberId ?? household?.treasurerMemberId ?? headMember?.id ?? null;
  }
  const actor = { memberId, isHead: await isHead(), canEdit: isEditor };
  if (!canActOnStep({ kind: "bill", payerId: e.memberId, treasurerId, hubLine: isHubLine }, actor)) { log.warn("toggleBillPaid", "blocked", { outcome: "blocked", reason: "not-allowed", memberId, id, periodId: e.periodId }); return; }
  if (!actor.isHead && !(await periodOpen(e.periodId))) { log.warn("toggleBillPaid", "blocked", { outcome: "blocked", reason: "period-closed", memberId, id, periodId: e.periodId }); return; }
  // leg=vendor → the SECOND leg of a two-step pool-funded misc (member → vendor). It has its own done
  // flag (vendorPaid) so it ticks independently of leg 1 (the hub → member disbursement, tracked by
  // `paid`). Same row, same authorization; only which flag flips differs.
  const vendorLeg = formData.get("leg") === "vendor";
  if (vendorLeg) {
    await prisma.expenseEntry.update({ where: { id }, data: { vendorPaid: !e.vendorPaid, vendorPaidAt: e.vendorPaid ? null : new Date() } });
    log.info("toggleBillPaid", "ok", { outcome: "ok", memberId, id, vendorPaid: !e.vendorPaid, periodId: e.periodId });
    await logActivity("expense", "updated", `${e.vendorPaid ? "Unmarked" : "Marked"} vendor payment “${e.label}” ${formatINR(e.amount)} paid`, e.periodId);
    revalidateFamily();
    return;
  }
  // Stamp the paid time when marking paid (cleared on un-mark) so the plan can show "paid <day>".
  await prisma.expenseEntry.update({ where: { id }, data: { paid: !e.paid, paidAt: e.paid ? null : new Date() } });
  log.info("toggleBillPaid", "ok", { outcome: "ok", memberId, id, paid: !e.paid, periodId: e.periodId });
  await logActivity("expense", "updated", `${e.paid ? "Unmarked" : "Marked"} bill “${e.label}” ${formatINR(e.amount)} paid`, e.periodId);
  revalidateFamily();
}

export type MiscPayState = { ok: boolean; n: number; error?: string };

// Pay a PLANNED MISC bill (an estimate) with its ACTUAL amount, reconciling the difference against the
// general Piggy — the misc analogue of the EB/fund-bill pay flow:
//   • spent LESS than estimated → the surplus goes INTO the Piggy;
//   • spent MORE → the extra is drawn FROM the Piggy; whatever the Piggy can't cover is logged as an
//     out-of-pocket Misc Spend on the payer (the modal confirms this before submitting).
// The Sheet line's amount stays the ESTIMATE (settlement basis); the reconciliation moves the diff.
// Every side-effect carries a stable `[mp<id>]` marker so unpayMiscBill can reverse it exactly.
export async function payMiscBill(prev: MiscPayState, formData: FormData): Promise<MiscPayState> {
  const session = await auth();
  const memberId = session?.user?.memberId ?? null;
  if (!(await unlocked())) await relock("payMiscBill");
  const id = Number(formData.get("id"));
  const e = await prisma.expenseEntry.findUnique({ where: { id }, include: { category: { select: { section: true, householdId: true } } } });
  if (!e) return { ok: false, n: prev.n, error: "Not found." };
  const isEditor = await canEdit();
  const isPayer = memberId != null && memberId === e.memberId;
  if (!isEditor && !isPayer) return { ok: false, n: prev.n, error: "Not allowed." };
  if (!(await isHead()) && !(await periodOpen(e.periodId))) return { ok: false, n: prev.n, error: "This month is closed." };
  if (e.paid) return { ok: false, n: prev.n, error: "Already paid." };
  if (e.category.section !== "Misc") return { ok: false, n: prev.n, error: "Not a misc bill." };

  const householdId = e.category.householdId;
  const round = (x: number) => Math.round(x * 100) / 100;
  const estimate = round(e.amount);
  const actualRaw = parseAmount(formData.get("amount"));
  const actual = actualRaw && actualRaw > 0 ? round(actualRaw) : estimate;
  const marker = `[mp${id}]`;

  const piggyAgg = await prisma.piggyEntry.aggregate({ where: { householdId, kind: "piggy" }, _sum: { amount: true } });
  const piggyAvail = Math.max(0, piggyAgg._sum.amount ?? 0);

  const diff = round(actual - estimate);
  let toPiggy = 0, fromPiggy = 0, outOfPocket = 0;
  if (diff < -0.005) toPiggy = round(-diff); // under-spent → surplus into the Piggy
  else if (diff > 0.005) { fromPiggy = round(Math.min(diff, piggyAvail)); outOfPocket = round(diff - fromPiggy); }

  const miscCat = outOfPocket > 0 ? await prisma.category.findFirst({ where: { householdId, section: "Misc", tracked: true } }) : null;
  await prisma.$transaction(async (tx) => {
    if (toPiggy > 0) await tx.piggyEntry.create({ data: { householdId, periodId: e.periodId, kind: "piggy", amount: toPiggy, note: `${e.label} — under-spent ${marker}` } });
    if (fromPiggy > 0) await tx.piggyEntry.create({ data: { householdId, periodId: e.periodId, kind: "piggy", amount: -fromPiggy, note: `${e.label} — over-spent ${marker}` } });
    if (outOfPocket > 0 && miscCat) await tx.spend.create({ data: { periodId: e.periodId, categoryId: miscCat.id, memberId: e.memberId, label: `${e.label} (out-of-pocket) ${marker}`, amount: outOfPocket, subCategory: null } });
    await tx.expenseEntry.update({ where: { id }, data: { paid: true, paidAt: new Date() } });
  });
  log.info("payMiscBill", "ok", { outcome: "ok", memberId, id, estimate, actual, toPiggy, fromPiggy, outOfPocket, periodId: e.periodId });
  await logActivity("expense", "created", `Paid misc “${e.label}” ${formatINR(actual)} (est. ${formatINR(estimate)})${toPiggy > 0 ? ` · ${formatINR(toPiggy)} → Piggy` : outOfPocket > 0 ? ` · ${formatINR(outOfPocket)} out-of-pocket` : fromPiggy > 0 ? ` · ${formatINR(fromPiggy)} from Piggy` : ""}`, e.periodId);
  revalidateFamily();
  return { ok: true, n: prev.n + 1 };
}

// Undo a misc-bill payment: reverse the Piggy deposit/withdrawal and the out-of-pocket Spend (found by
// the [mp<id>] marker), and clear the paid flag. Head/manager or the payer; open month (head any).
export async function unpayMiscBill(formData: FormData) {
  const session = await auth();
  const memberId = session?.user?.memberId ?? null;
  if (!(await unlocked())) await relock("unpayMiscBill");
  const id = Number(formData.get("id"));
  const e = await prisma.expenseEntry.findUnique({ where: { id } });
  if (!e || !e.paid) return;
  const isEditor = await canEdit();
  const isPayer = memberId != null && memberId === e.memberId;
  if (!isEditor && !isPayer) return;
  if (!(await isHead()) && !(await periodOpen(e.periodId))) return;
  const marker = `[mp${id}]`;
  await prisma.$transaction(async (tx) => {
    await tx.piggyEntry.deleteMany({ where: { periodId: e.periodId, note: { endsWith: marker } } });
    await tx.spend.deleteMany({ where: { periodId: e.periodId, label: { endsWith: marker } } });
    await tx.expenseEntry.update({ where: { id }, data: { paid: false, paidAt: null } });
  });
  log.info("unpayMiscBill", "ok", { outcome: "ok", memberId, id, periodId: e.periodId });
  await logActivity("expense", "updated", `Unmarked misc “${e.label}” paid`, e.periodId);
  revalidateFamily();
}

// Tick an income arrival "received" in the Money Plan — strikes the row through (display only; it
// does NOT move cash or count toward plan progress). Head/manager, or the income's own owner, and
// (unless head) only while the month is still open — same permission shape as toggleBillPaid.
export async function toggleIncomeReceived(formData: FormData) {
  const session = await auth();
  const memberId = session?.user?.memberId ?? null;
  if (!(await unlocked())) await relock("toggleIncomeReceived");
  const id = Number(formData.get("id"));
  const e = await prisma.incomeEntry.findUnique({ where: { id } });
  if (!e) { log.warn("toggleIncomeReceived", "blocked", { outcome: "blocked", reason: "not-found", memberId, id }); return; }
  const actor = { memberId, isHead: await isHead(), canEdit: await canEdit() };
  if (!canActOnStep({ kind: "income", ownerId: e.ownerId }, actor)) { log.warn("toggleIncomeReceived", "blocked", { outcome: "blocked", reason: "not-allowed", memberId, id, periodId: e.periodId }); return; }
  if (!actor.isHead && !(await periodOpen(e.periodId))) { log.warn("toggleIncomeReceived", "blocked", { outcome: "blocked", reason: "period-closed", memberId, id, periodId: e.periodId }); return; }
  await prisma.incomeEntry.update({ where: { id }, data: { receivedAt: e.receivedAt ? null : new Date() } });
  log.info("toggleIncomeReceived", "ok", { outcome: "ok", memberId, id, received: !e.receivedAt, periodId: e.periodId });
  await logActivity("income", "updated", `${e.receivedAt ? "Unmarked" : "Marked"} income “${e.source}” ${formatINR(e.amount)} received`, e.periodId);
  revalidateFamily();
}

// ── Money Plan: head-editable steps (persist across a refresh) ──────────────────────────────────
// Add an ad-hoc member↔member (or ↔ hub) move, inserted right after `afterStepKey` (empty = top).
export async function addManualStep(formData: FormData) {
  const session = await auth();
  const memberId = session?.user?.memberId ?? null;
  if (!(await unlocked())) await relock("addManualStep");
  if (!(await canEdit())) { log.warn("addManualStep", "blocked", { outcome: "blocked", reason: "not-allowed", memberId }); return; }
  const periodId = Number(formData.get("periodId"));
  const fromMemberId = Number(formData.get("fromMemberId"));
  const toMemberId = Number(formData.get("toMemberId"));
  const amount = Math.round((Number(formData.get("amount")) || 0) * 100) / 100;
  const afterStepKey = String(formData.get("afterStepKey") ?? "").trim() || null;
  const dayRaw = formData.get("day");
  const day = dayRaw ? Number(dayRaw) : null;
  if (!periodId || !fromMemberId || !toMemberId || amount <= 0 || fromMemberId === toMemberId) return;
  if (!(await isHead()) && !(await periodOpen(periodId))) return;
  await prisma.manualPlanStep.create({ data: { periodId, fromMemberId, toMemberId, amount, afterStepKey, day } });
  log.info("addManualStep", "ok", { outcome: "ok", memberId, periodId, amount });
  await logActivity("settlement", "created", `Added a manual move ${formatINR(amount)}`, periodId);
  revalidateFamily();
}

export async function deleteManualStep(formData: FormData) {
  if (!(await unlocked())) await relock("deleteManualStep");
  if (!(await canEdit())) return;
  const id = Number(formData.get("id"));
  const m = await prisma.manualPlanStep.findUnique({ where: { id } });
  if (!m) return;
  if (!(await isHead()) && !(await periodOpen(m.periodId))) return;
  await prisma.manualPlanStep.delete({ where: { id } });
  await logActivity("settlement", "deleted", `Removed a manual move ${formatINR(m.amount)}`, m.periodId);
  revalidateFamily();
}

// Tick a manual step done — head/manager, or either party to the move; open month unless head.
export async function toggleManualStepDone(formData: FormData) {
  const session = await auth();
  const memberId = session?.user?.memberId ?? null;
  if (!(await unlocked())) await relock("toggleManualStepDone");
  const id = Number(formData.get("id"));
  const m = await prisma.manualPlanStep.findUnique({ where: { id } });
  if (!m) return;
  const actor = { memberId, isHead: await isHead(), canEdit: await canEdit() };
  if (!canActOnStep({ kind: "manual", fromId: m.fromMemberId, toId: m.toMemberId }, actor)) return;
  if (!actor.isHead && !(await periodOpen(m.periodId))) return;
  await prisma.manualPlanStep.update({ where: { id }, data: { done: !m.done } });
  await logActivity("settlement", "updated", `${m.done ? "Unmarked" : "Marked"} a manual move ${formatINR(m.amount)} done`, m.periodId);
  revalidateFamily();
}

// Tick a combined pool hand-over (holder → treasurer) received — marks every underlying PoolHandover
// row handed over, or undoes it. The holder themselves or the head/manager can tick it.
export async function togglePoolHandover(formData: FormData) {
  const session = await auth();
  const memberId = session?.user?.memberId ?? null;
  if (!(await unlocked())) await relock("togglePoolHandover");
  const ids = String(formData.get("ids") ?? "").split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
  if (ids.length === 0) return;
  const rows = await prisma.poolHandover.findMany({ where: { id: { in: ids } }, select: { id: true, periodId: true, fromMemberId: true, handedOverAt: true } });
  if (rows.length === 0) return;
  const periodId = rows[0].periodId;
  // A combined hand-over is one holder's rows; if they all share a holder, that's the actor allowed to
  // tick it (else only head/manager). Same rule as before, via the shared canActOnStep.
  const holderId = rows.every((r) => r.fromMemberId === rows[0].fromMemberId) ? rows[0].fromMemberId : null;
  const actor = { memberId, isHead: await isHead(), canEdit: await canEdit() };
  if (!canActOnStep({ kind: "pool-handover", fromId: holderId }, actor)) return;
  if (!actor.isHead && !(await periodOpen(periodId))) return;
  const allDone = rows.every((r) => r.handedOverAt != null);
  await prisma.poolHandover.updateMany({ where: { id: { in: ids } }, data: { handedOverAt: allDone ? null : new Date() } });
  await logActivity("settlement", "updated", allDone ? "Undid a pool hand-over to the treasurer" : "Marked a pool hand-over received by the treasurer", periodId);
  revalidateFamily();
}

// Hide a derived step from the plan VIEW (Sheet untouched); un-hide by deleting the marker.
export async function hideStep(formData: FormData) {
  if (!(await unlocked())) await relock("hideStep");
  if (!(await canEdit())) return;
  const periodId = Number(formData.get("periodId"));
  const stepKey = String(formData.get("stepKey") ?? "").trim();
  if (!periodId || !stepKey) return;
  if (!(await isHead()) && !(await periodOpen(periodId))) return;
  await prisma.hiddenPlanStep.upsert({ where: { periodId_stepKey: { periodId, stepKey } }, create: { periodId, stepKey }, update: {} });
  revalidateFamily();
}

export async function unhideStep(formData: FormData) {
  if (!(await unlocked())) await relock("unhideStep");
  if (!(await canEdit())) return;
  const periodId = Number(formData.get("periodId"));
  const stepKey = String(formData.get("stepKey") ?? "").trim();
  if (!periodId || !stepKey) return;
  await prisma.hiddenPlanStep.deleteMany({ where: { periodId, stepKey } });
  revalidateFamily();
}

// Pay a due-month "save the share" bill from the In Hand tab (head/manager, open month).
// The bill's own fund is used FIRST and fully; any remainder comes from the general Piggy or
// out-of-pocket (recorded as the payer's Misc spend). Idempotent via BillPayment (one per
// category+period), so it survives a rebuild.
export type PayBillState = { ok: boolean; error?: string; n: number };

export async function payPeriodicBill(prev: PayBillState, formData: FormData): Promise<PayBillState> {
  const session = await auth();
  const memberId = session?.user?.memberId ?? null;
  const categoryId = Number(formData.get("categoryId"));
  const periodId = Number(formData.get("periodId"));
  const source = String(formData.get("source") ?? "pocket");
  const ctx = { memberId, categoryId, periodId, source };
  const fail = (error: string, reason: string, extra: Record<string, unknown> = {}): PayBillState => {
    log.warn("payPeriodicBill", "blocked", { outcome: "blocked", reason, ...ctx, ...extra });
    return { ok: false, error, n: prev.n + 1 };
  };

  // App-lock collapsed (session cookie gone, e.g. app was reopened): don't fail silently —
  // send them to the PIN so they can re-unlock, then retry. This is the common cause of
  // "I clicked Paid and nothing happened".
  if (!(await unlocked())) await relock("payPeriodicBill");
  if (!categoryId || !periodId) return fail("Something's off with this bill — reload and try again.", "bad-input");
  // Where the money actually moves. Normally the same open month. For a CARRIED (late) payment
  // of a prior CLOSED month's bill, the obligation stays `periodId` (closed, so its record marks
  // that month resolved) but the fund/Piggy draw + any out-of-pocket land in the current OPEN
  // month (`spendPeriodId`) so a settled month isn't disturbed.
  const spendPeriodId = Number(formData.get("spendPeriodId")) || periodId;
  const carried = spendPeriodId !== periodId;
  if (!(await periodOpen(spendPeriodId))) return fail("This month is locked — it's already been closed.", "period-locked", { spendPeriodId });
  const cat = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!cat || cat.fundingStyle !== "auto" || cat.billAmount == null || cat.billAmount <= 0) return fail("This bill can't be paid this way.", "not-a-fund-bill");
  const bill = cat.billAmount;
  const payer = cat.payerMemberId ?? cat.responsibleMemberId ?? null;

  // Head + manager may pay any bill; the bill's own payer may pay (or undo) their own bill too.
  const isEditor = await canEdit();
  const isPayer = memberId != null && memberId === payer;
  if (!isEditor && !isPayer) return fail("Only the bill's payer or a manager can mark this paid.", "not-allowed", { payer });

  const already = await prisma.billPayment.findUnique({ where: { categoryId_periodId: { categoryId, periodId } } });
  if (already) return fail("This bill is already marked paid for the month.", "already-paid");

  // "Already paid" — pure record, no money moves (fund/Piggy untouched, no misc spend).
  if (source === "already") {
    await prisma.billPayment.create({ data: { householdId: cat.householdId, categoryId, periodId, spendPeriodId, memberId: payer, fromFund: 0, fromPiggy: 0, outOfPocket: 0 } });
    await logActivity("expense", "created", `Marked ${cat.name} bill already paid (outside)`, spendPeriodId);
    log.info("payPeriodicBill", "ok", { outcome: "ok", ...ctx, mode: "already", amount: 0 });
    revalidateFamily();
    return { ok: true, n: prev.n + 1 };
  }

  const [fundAgg, piggyAgg, setAsideAgg] = await Promise.all([
    prisma.piggyEntry.aggregate({ where: { householdId: cat.householdId, categoryId, kind: "sinking" }, _sum: { amount: true } }),
    prisma.piggyEntry.aggregate({ where: { householdId: cat.householdId, kind: "piggy" }, _sum: { amount: true } }),
    // this month's own set-aside — allowed toward the bill (not yet accrued; wind-down reconciles)
    prisma.expenseEntry.aggregate({ where: { periodId, categoryId, OR: [{ label: { endsWith: "(saving)" } }, { label: { endsWith: "(monthly share)" } }] }, _sum: { amount: true } }),
  ]);
  const round = (x: number) => Math.round(x * 100) / 100;
  const accrued = Math.max(0, round(fundAgg._sum.amount ?? 0)); // real, already-in-the-fund money
  // this month's own share (not yet accrued). A carried pay's closed month already accrued its
  // share into the fund at wind-down, so it's part of `accrued` — don't count it again here.
  const setAside = carried ? 0 : Math.max(0, round(setAsideAgg._sum.amount ?? 0));
  const piggyAvail = Math.max(0, piggyAgg._sum.amount ?? 0);

  // The actual amount to pay (varies per bill); defaults to the configured bill. Anything the
  // fund doesn't need is simply left in the fund (we only draw what's paid).
  const actualRaw = parseAmount(formData.get("amount"));
  const actual = actualRaw && actualRaw > 0 ? round(actualRaw) : bill;

  // Offset model — the fund never goes negative:
  //  1. draw from the ACCRUED fund only (a real ledger draw, ≤ accrued),
  //  2. then cover from THIS month's set-aside (fromSetAside) — no ledger draw; it simply
  //     cancels that set-aside's wind-down accrual (the money goes straight to the bill),
  //  3. then the general Piggy, 4. then out-of-pocket (the payer's misc spend).
  const fromFund = round(Math.min(accrued, actual));
  let remaining = round(actual - fromFund);
  const fromSetAside = round(Math.min(setAside, remaining));
  remaining = round(remaining - fromSetAside);
  let fromPiggy = 0;
  if (remaining > 0 && source === "piggy") {
    fromPiggy = round(Math.min(piggyAvail, remaining));
    remaining = round(remaining - fromPiggy);
  }
  const outOfPocket = remaining; // whatever's left is out-of-pocket

  const miscCat = outOfPocket > 0 ? await prisma.category.findFirst({ where: { householdId: cat.householdId, section: "Misc", tracked: true } }) : null;
  await prisma.$transaction(async (tx) => {
    if (fromFund > 0) await tx.piggyEntry.create({ data: { householdId: cat.householdId, periodId: spendPeriodId, categoryId, kind: "sinking", amount: -fromFund, note: `${cat.name} bill paid${carried ? " (carried)" : ""}` } });
    if (fromPiggy > 0) await tx.piggyEntry.create({ data: { householdId: cat.householdId, periodId: spendPeriodId, kind: "piggy", amount: -fromPiggy, note: `${cat.name} bill paid${carried ? " (carried)" : ""}` } });
    if (outOfPocket > 0 && miscCat) await tx.spend.create({ data: { periodId: spendPeriodId, categoryId: miscCat.id, memberId: payer, label: `${cat.name} bill (out-of-pocket)`, amount: outOfPocket, subCategory: null } });
    await tx.billPayment.create({ data: { householdId: cat.householdId, categoryId, periodId, spendPeriodId, memberId: payer, fromFund, fromSetAside, fromPiggy, outOfPocket } });
  });
  await logActivity("expense", "created", `Paid ${cat.name} bill ${formatINR(actual)}${carried ? " (carried)" : ""}`, spendPeriodId);
  log.info("payPeriodicBill", "ok", { outcome: "ok", ...ctx, mode: source, amount: actual, fromFund, fromPiggy, outOfPocket });
  revalidateFamily();
  return { ok: true, n: prev.n + 1 };
}

// Undo a periodic-bill payment (head/manager, open month): reverse the fund/Piggy draws and the
// out-of-pocket Misc spend, and drop the BillPayment record.
export async function unpayPeriodicBill(formData: FormData) {
  const session = await auth();
  const memberId = session?.user?.memberId ?? null;
  if (!(await unlocked())) await relock("unpayPeriodicBill");
  const categoryId = Number(formData.get("categoryId"));
  const periodId = Number(formData.get("periodId"));
  if (!categoryId || !periodId) return;
  const bp = await prisma.billPayment.findUnique({ where: { categoryId_periodId: { categoryId, periodId } } });
  if (!bp) { log.warn("unpayPeriodicBill", "blocked", { outcome: "blocked", reason: "no-payment", memberId, categoryId, periodId }); return; }
  // head + manager may undo any payment; the bill's own payer may undo their own.
  const isPayer = memberId != null && memberId === bp.memberId;
  if (!(await canEdit()) && !isPayer) { log.warn("unpayPeriodicBill", "blocked", { outcome: "blocked", reason: "not-allowed", memberId, categoryId, periodId }); return; }
  const sp = bp.spendPeriodId ?? bp.periodId; // where the money moved (the OPEN month for a carried pay)
  if (!(await periodOpen(sp))) { log.warn("unpayPeriodicBill", "blocked", { outcome: "blocked", reason: "period-locked", memberId, categoryId, periodId, sp }); return; }
  const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { name: true } });
  await prisma.$transaction(async (tx) => {
    if (bp.fromFund > 0) await tx.piggyEntry.create({ data: { householdId: bp.householdId, periodId: sp, categoryId, kind: "sinking", amount: bp.fromFund, note: `${cat?.name ?? "bill"} payment undone` } });
    if (bp.fromPiggy > 0) await tx.piggyEntry.create({ data: { householdId: bp.householdId, periodId: sp, kind: "piggy", amount: bp.fromPiggy, note: `${cat?.name ?? "bill"} payment undone` } });
    if (bp.outOfPocket > 0) await tx.spend.deleteMany({ where: { periodId: sp, memberId: bp.memberId, amount: bp.outOfPocket, label: { endsWith: "(out-of-pocket)" } } });
    await tx.billPayment.delete({ where: { id: bp.id } });
  });
  log.info("unpayPeriodicBill", "ok", { outcome: "ok", memberId, categoryId, periodId });
  revalidateFamily();
}

// Choose who holds the Piggy / pool in the in-hand view (head + manager). Default = head.
export async function setPiggyHolder(formData: FormData) {
  if (!(await canEdit())) return; // head + manager
  const raw = formData.get("memberId");
  const memberId = raw ? Number(raw) : null;
  const household = await prisma.household.findFirst({ select: { id: true } });
  if (!household) return;
  if (memberId != null) {
    const m = await prisma.member.findFirst({ where: { id: memberId, householdId: household.id } });
    if (!m) return;
  }
  await prisma.household.update({ where: { id: household.id }, data: { piggyHolderMemberId: memberId } });
  revalidateFamily();
}

// Mark one settlement transfer (from → to) as paid for a month. Head-only.
export async function markSettled(formData: FormData) {
  const session = await auth();
  const householdId = Number(formData.get("householdId"));
  const periodId = Number(formData.get("periodId"));
  const fromMemberId = Number(formData.get("fromMemberId"));
  const toMemberId = Number(formData.get("toMemberId"));
  const amount = parseAmount(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim() || null;
  // The ticked step's stable id — one payment row per step (per-payment model). Falls back to the
  // pair so an un-keyed tick still records something, but the Money Plan always sends a key.
  const key = String(formData.get("key") ?? "").trim() || `pair-${fromMemberId}-${toMemberId}`;
  if (!householdId || !periodId || !fromMemberId || !toMemberId || !amount) return;
  await requireUnlocked("markSettled");
  // head, OR the payer/receiver of THIS transfer, may mark it settled (shared canActOnStep)
  const me = session?.user?.memberId ?? null;
  if (!canActOnStep({ kind: "transfer-out", fromId: fromMemberId, toId: toMemberId }, { memberId: me, isHead: session?.user?.role === "head", canEdit: false })) return;

  // Upsert on (periodId, key): ticking a piece records EXACTLY its own slice as one payment, and a
  // double-click updates the same row instead of double-recording. A creditor's total paid is the SUM
  // of these rows, so several slices never collapse into one growing figure.
  await prisma.settlementRecord.upsert({
    where: { periodId_key: { periodId, key } },
    update: { amount, note, fromMemberId, toMemberId, settledById: session?.user?.memberId ?? null, settledAt: new Date() },
    create: {
      householdId,
      periodId,
      fromMemberId,
      toMemberId,
      amount,
      note,
      key,
      settledById: session?.user?.memberId ?? null,
    },
  });
  const pair = await prisma.member.findMany({ where: { id: { in: [fromMemberId, toMemberId] } }, select: { id: true, name: true } });
  const nm = (mid: number) => pair.find((p) => p.id === mid)?.name ?? `#${mid}`;
  await logActivity("settlement", "created", `Settled ${formatINR(amount)}: ${nm(fromMemberId)} → ${nm(toMemberId)}`, periodId);
  revalidateFamily();
}

// Undo a recorded settlement. Head-only.
export async function unsettle(formData: FormData) {
  const session = await auth();
  const id = Number(formData.get("id"));
  if (!id) return;
  const rec = await prisma.settlementRecord.findUnique({ where: { id } });
  if (!rec) return;
  await requireUnlocked("unsettle");
  // head, OR the payer/receiver of this transfer, may undo it (shared canActOnStep)
  const me = session?.user?.memberId ?? null;
  if (!canActOnStep({ kind: "transfer-out", fromId: rec.fromMemberId, toId: rec.toMemberId }, { memberId: me, isHead: session?.user?.role === "head", canEdit: false })) return;
  await prisma.settlementRecord.delete({ where: { id } });
  await logActivity("settlement", "deleted", `Undid a settlement (${formatINR(rec.amount)})`, rec.periodId);
  revalidateFamily();
}

// Mark a funding advance leg paid. leg="payback" ticks the return (borrower → funder); otherwise the
// front (funder → borrower). Head, or either party.
export async function markAdvanceSettled(formData: FormData) {
  const session = await auth();
  const id = Number(formData.get("id"));
  if (!id) return;
  await requireUnlocked("markAdvanceSettled");
  const adv = await prisma.advance.findUnique({ where: { id } });
  if (!adv) return;
  const me = session?.user?.memberId ?? null;
  if (!canActOnStep({ kind: "advance", fromId: adv.fromMemberId, toId: adv.toMemberId }, { memberId: me, isHead: session?.user?.role === "head", canEdit: false })) return;
  const payback = formData.get("leg") === "payback";
  await prisma.advance.update({ where: { id }, data: payback ? { paybackSettled: true, paybackSettledAt: new Date() } : { settled: true, settledAt: new Date() } });
  await logActivity("settlement", "created", `Marked an advance ${payback ? "repaid" : "paid"} (${formatINR(adv.amount)})`, adv.periodId);
  revalidateFamily();
}
// Undo a funding advance leg's paid mark (leg="payback" → the return), or delete the whole advance
// (delete=1) — e.g. it's no longer needed.
export async function unsettleAdvance(formData: FormData) {
  const session = await auth();
  const id = Number(formData.get("id"));
  if (!id) return;
  await requireUnlocked("unsettleAdvance");
  const adv = await prisma.advance.findUnique({ where: { id } });
  if (!adv) return;
  const me = session?.user?.memberId ?? null;
  if (!canActOnStep({ kind: "advance", fromId: adv.fromMemberId, toId: adv.toMemberId }, { memberId: me, isHead: session?.user?.role === "head", canEdit: false })) return;
  if (formData.get("delete") === "1") await prisma.advance.delete({ where: { id } });
  else if (formData.get("leg") === "payback") await prisma.advance.update({ where: { id }, data: { paybackSettled: false, paybackSettledAt: null } });
  else await prisma.advance.update({ where: { id }, data: { settled: false, settledAt: null } });
  revalidateFamily();
}

// ---- Loans & chits (head-only) ----
export async function createLoan(formData: FormData) {
  if (!(await isHead())) return;
  const householdId = Number(formData.get("householdId"));
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "loan") === "chit" ? "chit" : "loan";
  const outstanding = Number(formData.get("outstanding")) || 0;
  const monthlyAmount = Number(formData.get("monthlyAmount")) || 0;
  const memberRaw = String(formData.get("memberId") ?? "").trim();
  const memberId = memberRaw === "" ? null : Number(memberRaw);
  const totalRaw = String(formData.get("totalInstallments") ?? "").trim();
  const totalInstallments = totalRaw === "" ? null : Number(totalRaw);
  const paidInstallments = Number(formData.get("paidInstallments")) || 0;
  const rateRaw = String(formData.get("interestRate") ?? "").trim();
  const interestRate = rateRaw === "" ? null : Number(rateRaw);
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!householdId || !name) return;
  await prisma.loan.create({
    data: { householdId, name, kind, outstanding, monthlyAmount, memberId, totalInstallments, paidInstallments, interestRate, note },
  });
  await logActivity("loan", "created", `Added ${kind} “${name}”`);
  revalidateFamily();
}

// Record a monthly payment / prepayment. principalPart reduces the outstanding;
// for chits it bumps the installment count. Auto-closes when done.
export async function recordLoanPayment(formData: FormData) {
  if (!(await isHead())) return;
  const loanId = Number(formData.get("loanId"));
  const periodId = formData.get("periodId") ? Number(formData.get("periodId")) : null;
  const amount = parseAmount(formData.get("amount")) || 0;
  const principalPart = Number(formData.get("principalPart")) || 0;
  const dividend = Number(formData.get("dividend")) || 0; // chit: dividend received this month
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!loanId || amount <= 0) return;
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) return;
  // Overdraw guard: can't pay off more principal than is outstanding.
  if (principalPart > loan.outstanding) return; // blocked (UI also guards)

  const newOutstanding = Math.max(0, loan.outstanding - principalPart);
  const newPaid = loan.kind === "chit" ? loan.paidInstallments + 1 : loan.paidInstallments;
  const done =
    (loan.kind === "loan" && principalPart > 0 && newOutstanding <= 0) ||
    (loan.kind === "chit" && loan.totalInstallments != null && newPaid >= loan.totalInstallments);

  await prisma.$transaction([
    prisma.loanPayment.create({ data: { loanId, periodId, amount, principalPart, dividend, note } }),
    prisma.loan.update({
      where: { id: loanId },
      data: { outstanding: newOutstanding, paidInstallments: newPaid, status: done ? "closed" : loan.status },
    }),
  ]);
  await logActivity("loan", "updated", `Paid ${formatINR(amount)} on “${loan.name}”`);
  revalidateFamily();
}

// Chit: record that the pot was won on a given installment, for a given amount.
export async function setChitWon(formData: FormData) {
  if (!(await isHead())) return;
  const loanId = Number(formData.get("loanId"));
  const installment = Number(formData.get("installment")) || null;
  const potAmount = Number(formData.get("potAmount")) || null;
  if (!loanId) return;
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) return;
  await prisma.loan.update({
    where: { id: loanId },
    data: { chitWonInstallment: installment, chitPotAmount: potAmount },
  });
  await logActivity(
    "loan",
    "updated",
    installment ? `Won the “${loan.name}” pot (${formatINR(potAmount ?? 0)})` : `Cleared pot-won on “${loan.name}”`,
  );
  revalidateFamily();
}

export async function closeLoan(formData: FormData) {
  if (!(await isHead())) return;
  const loanId = Number(formData.get("loanId"));
  if (!loanId) return;
  const loan = await prisma.loan.update({ where: { id: loanId }, data: { status: "closed" } });
  await logActivity("loan", "updated", `Closed “${loan.name}”`);
  revalidateFamily();
}

export async function deleteLoan(formData: FormData) {
  if (!(await isHead())) return;
  const loanId = Number(formData.get("loanId"));
  if (!loanId) return;
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  await prisma.loan.delete({ where: { id: loanId } });
  if (loan) await logActivity("loan", "deleted", `Deleted “${loan.name}”`);
  revalidateFamily();
}

// Delete a single loan/chit payment (correction). Reverses its effect on the loan.
export async function deleteLoanPayment(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("id"));
  if (!id) return;
  const p = await prisma.loanPayment.findUnique({ where: { id }, include: { loan: true } });
  if (!p) return;
  const newPaid = p.loan.kind === "chit" ? Math.max(0, p.loan.paidInstallments - 1) : p.loan.paidInstallments;
  await prisma.$transaction([
    prisma.loanPayment.delete({ where: { id } }),
    prisma.loan.update({
      where: { id: p.loanId },
      data: { outstanding: p.loan.outstanding + p.principalPart, paidInstallments: newPaid },
    }),
  ]);
  await logActivity("loan", "updated", `Removed a payment on “${p.loan.name}”`);
  revalidateFamily();
}

// Head edits a category's recurring defaults on the Monthly Setup screen.
// useActionState-shaped so the UI can toast success/errors. `n` increments per
// save so the client effect fires even when the ok/error value repeats.
export type SaveRecurringState = { ok: boolean; error?: string; n: number };

export async function saveRecurring(
  prev: SaveRecurringState,
  formData: FormData,
): Promise<SaveRecurringState> {
  const n = (prev?.n ?? 0) + 1;
  if (!(await isHead())) return { ok: false, error: "Only the head can edit setup.", n };
  const id = Number(formData.get("categoryId"));
  if (!id) return { ok: false, error: "Missing category.", n };
  const billing = parseBillingFields(formData);
  if (!billing.ok) return { ok: false, error: billing.error, n };
  const respRaw = String(formData.get("responsibleMemberId") ?? "").trim();
  const responsibleMemberId = respRaw === "" ? null : Number(respRaw);

  const cat = await prisma.category.findUnique({ where: { id } });
  if (!cat) return { ok: false, error: "Category not found.", n };

  // name + section are head-editable in Setup (rename / move between sections)
  const name = String(formData.get("name") ?? "").trim() || cat.name;
  const sectionRaw = String(formData.get("section") ?? "").trim();
  const section = (CATEGORY_SECTIONS as readonly string[]).includes(sectionRaw) ? sectionRaw : cat.section;

  try {
    await prisma.category.update({
      where: { id },
      // saving is an explicit review → clear the migrated "review due month" flag
      data: { name, section, responsibleMemberId, needsReview: false, ...billing.fields },
    });
  } catch {
    // unique-name clash → keep the old name, still apply the rest
    await prisma.category.update({
      where: { id },
      data: { section, responsibleMemberId, needsReview: false, ...billing.fields },
    });
    revalidateFamily();
    return { ok: false, error: `"${name}" is already taken — saved everything except the name.`, n };
  }

  // Setup edits define the recurring TEMPLATE only — the current open month is left
  // untouched. The change takes effect from next month (clonePeriodInto regenerates
  // each Setup category's tagged Sheet line + budget from the template).
  revalidateFamily();
  return { ok: true, n };
}

// Batch-save every edited Setup row in ONE go (the single "Save changes" bar). `rows` is a
// JSON array of the changed rows; each is validated then applied in a transaction (all-or-nothing).
export async function saveAllRecurring(
  prev: SaveRecurringState,
  formData: FormData,
): Promise<SaveRecurringState> {
  const n = (prev?.n ?? 0) + 1;
  if (!(await isHead())) return { ok: false, error: "Only the head can edit setup.", n };
  let rows: Record<string, string>[];
  try {
    rows = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { ok: false, error: "Couldn't read the changes.", n };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true, n };

  const parsed: { id: number; name: string; section: string; responsibleMemberId: number | null; payerMemberId: number | null; isAllowance: boolean; fields: BillingFields }[] = [];
  for (const r of rows) {
    const id = Number(r.id);
    if (!id) continue;
    const name = String(r.name ?? "").trim();
    if (!name) return { ok: false, error: "Every row needs a name.", n };
    const billing = parseBilling((k) => (r[k] != null ? String(r[k]) : null));
    if (!billing.ok) return { ok: false, error: `${name}: ${billing.error}`, n };
    const sectionRaw = String(r.section ?? "").trim();
    const section = (CATEGORY_SECTIONS as readonly string[]).includes(sectionRaw) ? sectionRaw : "Monthly";
    parsed.push({
      id,
      name,
      section,
      responsibleMemberId: r.responsibleMemberId ? Number(r.responsibleMemberId) : null,
      payerMemberId: r.payerMemberId ? Number(r.payerMemberId) : null,
      isAllowance: r.isAllowance === "on",
      fields: billing.fields,
    });
  }
  try {
    await prisma.$transaction(
      parsed.map((u) =>
        prisma.category.update({
          where: { id: u.id },
          // saving is an explicit review → clears the migrated "review due month" flag
          data: { name: u.name, section: u.section, responsibleMemberId: u.responsibleMemberId, payerMemberId: u.payerMemberId, isAllowance: u.isAllowance, needsReview: false, ...u.fields },
        }),
      ),
    );
  } catch {
    return { ok: false, error: "Couldn't save — a category name may already be taken.", n };
  }
  revalidateFamily();
  return { ok: true, n };
}

// Head sets the monthly close day (1–28) that drives the wind-down reminder.
export async function setWindDownDay(formData: FormData) {
  if (!(await isHead())) return;
  const raw = String(formData.get("windDownDay") ?? "").trim();
  const day = raw === "" ? null : Number(raw);
  if (day != null && (Number.isNaN(day) || day < 1 || day > 28)) return;
  const household = await prisma.household.findFirst();
  if (!household) return;
  await prisma.household.update({ where: { id: household.id }, data: { windDownDay: day } });
  revalidateFamily();
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// Clone last month's recurring structure (income + expense lines + budgets) into a
// new period. Regenerates each Setup category's tagged line from the template.
// Single source of truth in src/lib/periodClone.ts (shared with ensureCurrentMonth).

export async function createPeriod(formData: FormData) {
  if (!(await isHead())) return;
  const householdId = Number(formData.get("householdId"));
  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  if (!householdId || !year || !month) return;

  const existing = await prisma.period.findUnique({
    where: { householdId_year_month: { householdId, year, month } },
  });
  if (existing) {
    revalidateFamily();
    return;
  }

  const label = `${new Date(year, month - 1, 1)
    .toLocaleString("en-US", { month: "short" })
    .toUpperCase()} ${year}`;

  await prisma.$transaction(async (tx) => {
    const p = await tx.period.create({ data: { householdId, year, month, label } });
    // always generate from the RecurringItem template (source of truth)
    await generateMonth(tx, p.id, householdId);
  });
  revalidateFamily();
}


// Add an ESTIMATED "last month surplus" income line to a draft, from the source
// (current open) month's live carry-out. Replaces any prior estimate.
async function addEstimatedSurplus(
  tx: Tx,
  source: { id: number; label: string; carryForward: number; householdId: number },
  targetId: number,
) {
  const [inc, exp, budgets, spends, trackedCats] = await Promise.all([
    tx.incomeEntry.aggregate({ where: { periodId: source.id }, _sum: { amount: true } }),
    tx.expenseEntry.aggregate({ where: { periodId: source.id }, _sum: { amount: true } }),
    tx.budget.findMany({ where: { periodId: source.id } }),
    tx.spend.findMany({ where: { periodId: source.id } }),
    tx.category.findMany({ where: { householdId: source.householdId, tracked: true, onHold: false } }),
  ]);
  // over-budget (non-sinking) folds into the carried balance — same rule as wind-down.
  const spentOf = (c: number) => spends.filter((s) => s.categoryId === c).reduce((t, s) => t + s.amount, 0);
  let overspend = 0;
  for (const cat of trackedCats) {
    if (cat.sinking) continue;
    const b = budgets.find((x) => x.categoryId === cat.id)?.planned ?? 0;
    if (b <= 0) continue;
    const rem = b - spentOf(cat.id);
    if (rem < 0) overspend += -rem;
  }
  const carryOut = source.carryForward + (inc._sum.amount ?? 0) - (exp._sum.amount ?? 0) - overspend;
  await tx.incomeEntry.deleteMany({ where: { periodId: targetId, note: SURPLUS_NOTE } });
  if (carryOut > 0) {
    await tx.incomeEntry.create({
      data: {
        periodId: targetId,
        source: `Last month surplus (est., from ${source.label})`,
        amount: Math.round(carryOut * 100) / 100,
        oneOff: true,
        note: SURPLUS_NOTE,
      },
    });
  }
}

// True when `period` is still open but the calendar month has already moved past it — the wind-down
// overhang window, where new spend belongs to the NEXT cycle, not this month's executing plan.
function inWindDownOverhang(period: { year: number; month: number; status: string }): boolean {
  if (period.status !== "open") return false;
  const now = new Date();
  return now.getFullYear() * 12 + (now.getMonth() + 1) > period.year * 12 + period.month;
}

// Add ESTIMATED carry-to-next-month expense lines to a draft from the source month:
// over-budget excess + misc spends (tracked, no-budget categories) — the same rule
// windDownMonth uses. Replaces any prior estimate.
async function addEstimatedCarry(
  tx: Tx,
  source: { id: number; label: string; householdId: number },
  targetId: number,
) {
  const [budgets, spends, trackedCats] = await Promise.all([
    tx.budget.findMany({ where: { periodId: source.id } }),
    tx.spend.findMany({ where: { periodId: source.id } }),
    tx.category.findMany({ where: { householdId: source.householdId, tracked: true, onHold: false } }),
  ]);
  const budgetOf = (c: number) => budgets.find((b) => b.categoryId === c)?.planned ?? 0;

  const mon = source.label.split(" ")[0]; // "JUL 2026" → "JUL"
  await tx.expenseEntry.deleteMany({ where: { periodId: targetId, note: CARRY_NOTE } });
  for (const c of trackedCats) {
    const b = budgetOf(c.id);
    if (c.sinking && b > 0) continue; // sinking → its fund, never carried
    if (b > 0) {
      // over-budget is folded into the estimated carry (addEstimatedSurplus), not a line
      continue;
    } else {
      // misc (no budget) → carry EACH spend as its own line, tagged to whoever spent
      // it (display only; excluded from settlement — the spend already credits them)
      for (const s of spends.filter((sp) => sp.categoryId === c.id)) {
        await tx.expenseEntry.create({
          data: { periodId: targetId, categoryId: c.id, label: `${mon} · ${s.label}`, amount: s.amount, memberId: s.memberId, necessary: true, oneOff: true, note: CARRY_NOTE },
        });
      }
    }
  }
}


// ── Next-month preview (head-only draft) ─────────────────────────────────────
// A draft is a Period with status "draft": it never resolves as the "current"
// month (loadCommon prefers "open"), can't be wound down (windDownMonth requires
// "open"), and is promoted to "open" when the month actually starts
// (ensureCurrentMonth) or when the current month winds down into it.
async function latestOpenPeriod(householdId: number) {
  return prisma.period.findFirst({
    where: { householdId, status: "open" },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
}

// The WORKING month = the EARLIEST still-open month (the one you close first at wind-down). "Next
// month" is built off this, so when a later month is already open (e.g. Aug prematurely promoted
// while Jul is the working month) we don't skip ahead and spawn a bogus month-after-next draft.
async function earliestOpenPeriod(householdId: number) {
  return prisma.period.findFirst({
    where: { householdId, status: "open" },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
}

function nextYM(year: number, month: number) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

async function clearPeriodRows(tx: Tx, periodId: number) {
  await tx.settlementRecord.deleteMany({ where: { periodId } });
  await tx.piggyEntry.deleteMany({ where: { periodId } });
  await tx.spend.deleteMany({ where: { periodId } });
  await tx.budget.deleteMany({ where: { periodId } });
  await tx.expenseEntry.deleteMany({ where: { periodId } });
  await tx.incomeEntry.deleteMany({ where: { periodId } });
}

// Rebuild-safe clear: wipe ONLY the generated rows — template lines (oneOff:false),
// carry/surplus estimates (marked notes) and budgets — so anything the family added by
// hand in the preview (a well-planned one-off expense/income: oneOff:true, no marker
// note) survives a rebuild. Manual spends are left untouched too.
async function clearGeneratedRows(tx: Tx, periodId: number) {
  // Preserve the head's intentional overrides through a rebuild: PINNED edits and "removed" tombstones
  // (oneOff + REMOVED_NOTE) survive; only untouched generated rows are wiped so generateMonth can
  // re-create them. generateMonth then skips regenerating any source that still has an override.
  const pinnedCats = (
    await tx.expenseEntry.findMany({ where: { periodId, pinned: true }, select: { categoryId: true } })
  ).map((e) => e.categoryId);
  await tx.budget.deleteMany({ where: { periodId, ...(pinnedCats.length ? { categoryId: { notIn: pinnedCats } } : {}) } });
  await tx.expenseEntry.deleteMany({ where: { periodId, OR: [{ oneOff: false, NOT: { pinned: true } }, { note: CARRY_NOTE }] } });
  await tx.incomeEntry.deleteMany({ where: { periodId, OR: [{ oneOff: false, NOT: { pinned: true } }, { note: SURPLUS_NOTE }] } });
}

// Create (or just open) the draft for the month AFTER the current open month, then go to it.
export async function createNextMonthDraft(formData: FormData) {
  if (!(await canEdit())) return; // head + manager
  const householdId = Number(formData.get("householdId"));
  if (!householdId) return;
  const current = await earliestOpenPeriod(householdId);
  if (!current) return;
  const { year, month } = nextYM(current.year, current.month);
  const label = `${new Date(year, month - 1, 1).toLocaleString("en-US", { month: "short" }).toUpperCase()} ${year}`;

  const existing = await prisma.period.findUnique({
    where: { householdId_year_month: { householdId, year, month } },
  });
  if (!existing) {
    await prisma.$transaction(async (tx) => {
      const p = await tx.period.create({ data: { householdId, year, month, label, status: "draft", carryForward: 0 } });
      await generateMonth(tx, p.id, householdId);
      await addEstimatedCarry(tx, current, p.id);
      await addEstimatedSurplus(tx, current, p.id);
      await applyBudgetShortfall(tx, current, p.id);
    });
  }
  revalidateFamily();
  redirect(`/?y=${year}&m=${month}`);
}

// Rebuild the draft from the current open month's template (discards any draft edits).
export async function rebuildDraft(formData: FormData) {
  if (!(await canEdit())) return; // head + manager
  const periodId = Number(formData.get("periodId"));
  const draft = await prisma.period.findUnique({ where: { id: periodId } });
  if (!draft || draft.status !== "draft") return;
  const current = await latestOpenPeriod(draft.householdId);
  if (!current) return;
  await prisma.$transaction(async (tx) => {
    await clearGeneratedRows(tx, periodId); // keep hand-added preview lines
    await generateMonth(tx, periodId, draft.householdId);
    await addEstimatedCarry(tx, current, periodId);
    await addEstimatedSurplus(tx, current, periodId);
    await applyBudgetShortfall(tx, current, periodId);
  });
  revalidateFamily();
  redirect(`/?y=${draft.year}&m=${draft.month}`);
}

// Refresh ONLY the estimate lines (last-month surplus + carried over-budget/misc) on a PROVISIONAL
// month — one that's open but whose earlier working month hasn't wound down yet — from that working
// month. Lets the family see the up-to-date carry before wind-down WITHOUT rebuilding (which would
// wipe their real bill-paid/settlement work). Touches only SURPLUS_NOTE / CARRY_NOTE lines; wind-
// down deletes & replaces these with the finals, so this can never double-count.
export async function refreshCarryEstimates(formData: FormData): Promise<{ ok: boolean; message: string }> {
  if (!(await canEdit())) return { ok: false, message: "Only the head or a manager can refresh." };
  const periodId = Number(formData.get("periodId"));
  const target = await prisma.period.findUnique({ where: { id: periodId }, select: { id: true, householdId: true, year: true, month: true } });
  if (!target) return { ok: false, message: "Month not found." };
  // The working month = the latest OPEN month strictly earlier than this one.
  const source = await prisma.period.findFirst({
    where: {
      householdId: target.householdId,
      status: "open",
      OR: [{ year: { lt: target.year } }, { year: target.year, month: { lt: target.month } }],
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { id: true, label: true, carryForward: true, householdId: true },
  });
  if (!source) return { ok: false, message: "No earlier open month to estimate from." };
  await prisma.$transaction(async (tx) => {
    await addEstimatedCarry(tx, { id: source.id, label: source.label, householdId: source.householdId }, target.id);
    await addEstimatedSurplus(tx, source, target.id);
    await applyBudgetShortfall(tx, { id: source.id, householdId: source.householdId, carryForward: source.carryForward }, target.id);
  });
  log.info("refreshCarryEstimates", "ok", { targetId: target.id, sourceId: source.id });
  revalidateFamily();
  return { ok: true, message: `Estimate refreshed from ${source.label}.` };
}

// Same as rebuildDraft but returns a result instead of redirecting, so the client can
// show a toast. Stays on the (already-open) draft page; revalidatePath refreshes it.
export async function rebuildDraftToast(formData: FormData): Promise<{ ok: boolean; message: string }> {
  if (!(await canEdit())) return { ok: false, message: "Only the head or a manager can rebuild." };
  const periodId = Number(formData.get("periodId"));
  const draft = await prisma.period.findUnique({ where: { id: periodId } });
  if (!draft || draft.status !== "draft") return { ok: false, message: "No draft to rebuild." };
  const current = await latestOpenPeriod(draft.householdId);
  if (!current) return { ok: false, message: "No open month to rebuild from." };
  await prisma.$transaction(async (tx) => {
    await clearGeneratedRows(tx, periodId); // keep hand-added preview lines
    await generateMonth(tx, periodId, draft.householdId);
    await addEstimatedCarry(tx, current, periodId);
    await addEstimatedSurplus(tx, current, periodId);
    await applyBudgetShortfall(tx, current, periodId);
  });
  revalidateFamily();
  return { ok: true, message: "Preview rebuilt from your latest setup." };
}

// Toggle whether an income / expense line repeats into next month (the oneOff flag).
export async function toggleIncomeRepeat(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("id"));
  const row = await prisma.incomeEntry.findUnique({ where: { id } });
  if (!row) return;
  await prisma.incomeEntry.update({ where: { id }, data: { oneOff: !row.oneOff } });
  revalidateFamily();
}

export async function toggleExpenseRepeat(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("id"));
  const row = await prisma.expenseEntry.findUnique({ where: { id } });
  if (!row) return;
  await prisma.expenseEntry.update({ where: { id }, data: { oneOff: !row.oneOff } });
  revalidateFamily();
}

// ── Recurring template CRUD (Setup = source of truth; months generate from it) ──

// From an installment total + which payment is "this month" (the current open month),
// compute the month of payment #1 (stored, so generation is deterministic/rebuild-safe).
async function installmentStartFrom(householdId: number, total: number | null, current: number) {
  if (!total || total <= 0) return { installmentsTotal: null, installmentStartYear: null, installmentStartMonth: null };
  const anchor = await latestOpenPeriod(householdId);
  const y0 = anchor?.year ?? new Date().getFullYear();
  const m0 = anchor?.month ?? new Date().getMonth() + 1;
  let y = y0, m = m0 - (Math.max(1, current) - 1);
  while (m < 1) { m += 12; y -= 1; }
  return { installmentsTotal: total, installmentStartYear: y, installmentStartMonth: m };
}

// Payment #1 of a NEW installment lands on next month by default (Setup changes apply from next
// month; the current sheet is frozen) — so the preview reads 1/N, not 2/N. "This month" anchors #1 to
// the current open month instead (numbering starts here; the frozen current sheet isn't touched).
async function installmentStartAnchored(householdId: number, total: number | null, startThisMonth: boolean) {
  if (!total || total <= 0) return { installmentsTotal: null, installmentStartYear: null, installmentStartMonth: null };
  const anchor = await latestOpenPeriod(householdId);
  let y = anchor?.year ?? new Date().getFullYear();
  let m = (anchor?.month ?? new Date().getMonth() + 1) + (startThisMonth ? 0 : 1);
  while (m > 12) { m -= 12; y += 1; }
  return { installmentsTotal: total, installmentStartYear: y, installmentStartMonth: m };
}
const stripInstNumber = (name: string) => name.replace(/\s+\d+\s*\/\s*\d+\s*$/, "").trim();

type ScheduleFields = {
  intervalMonths: number;
  installmentsTotal: number | null;
  installmentStartYear: number | null;
  installmentStartMonth: number | null;
  dueDay: number | null;
};

// Build the schedule (every-month | installment N-times | periodic every-N-months) from
// the Setup form. `scheduleKind` selects the mode; unknown/absent → plain monthly.
async function scheduleFromForm(householdId: number, formData: FormData): Promise<ScheduleFields> {
  const kind = String(formData.get("scheduleKind") ?? "monthly");
  // Due day / arrival day (1–31) is independent of the repeat schedule — it's the day of the
  // month this expense is due (or income arrives). Empty → no date (shown as "normal").
  const dueDay = formData.get("dueDay") ? Math.min(31, Math.max(1, Number(formData.get("dueDay")))) : null;
  if (kind === "installment") {
    const total = formData.get("installmentsTotal") ? Number(formData.get("installmentsTotal")) : null;
    // ADD flow sends installmentStart ("next"|"this") → anchor #1 to next/this month. EDIT flow sends
    // installmentCurrent (which payment is the current open month) → preserves the existing start.
    const startSel = formData.get("installmentStart");
    if (startSel != null) {
      const inst = await installmentStartAnchored(householdId, total, String(startSel) === "this");
      return { intervalMonths: 1, dueDay, ...inst };
    }
    const current = Number(formData.get("installmentCurrent")) || 1;
    const inst = await installmentStartFrom(householdId, total, current);
    return { intervalMonths: 1, dueDay, ...inst };
  }
  if (kind === "periodic") {
    const interval = Math.min(60, Math.max(2, Number(formData.get("intervalMonths")) || 12));
    const y = Number(formData.get("periodicYear")) || new Date().getFullYear();
    const m = Math.min(12, Math.max(1, Number(formData.get("periodicMonth")) || 1));
    const total = formData.get("periodicCount") ? Math.max(1, Number(formData.get("periodicCount"))) : null;
    return { intervalMonths: interval, installmentsTotal: total, installmentStartYear: y, installmentStartMonth: m, dueDay };
  }
  return { intervalMonths: 1, installmentsTotal: null, installmentStartYear: null, installmentStartMonth: null, dueDay };
}

export async function createRecurringItem(formData: FormData) {
  if (!(await isHead())) return;
  const householdId = Number(formData.get("householdId"));
  const kind = formData.get("kind") === "income" ? "income" : "expense";
  let name = String(formData.get("name") ?? "").trim();
  const amount = parseAmount(formData.get("amount"));
  const rawCat = String(formData.get("categoryId") ?? "");
  let categoryId: number | null = /^\d+$/.test(rawCat) ? Number(rawCat) : null;
  const memberId = formData.get("memberId") ? Number(formData.get("memberId")) : null;
  if (!householdId || !name || !amount || amount <= 0) return;
  // Create-a-new-category inline (e.g. a new EMI under Monthly) when none is picked — same shape as the
  // Sheet's Add-expense modal: a name + a chosen section. Reuses an existing category of that name.
  if (kind === "expense" && !categoryId) {
    const newCatName = String(formData.get("newCategoryName") ?? "").trim();
    if (newCatName) {
      const section = String(formData.get("newCategorySection") ?? "Monthly");
      const existing = await prisma.category.findFirst({ where: { householdId, name: newCatName } });
      categoryId = existing?.id ?? (await prisma.category.create({ data: { householdId, name: newCatName, section } })).id;
    }
  }
  if (kind === "expense" && !categoryId) return;
  const sched = await scheduleFromForm(householdId, formData);
  if (sched.installmentsTotal && sched.intervalMonths === 1) name = stripInstNumber(name);
  const max = await prisma.recurringItem.aggregate({ where: { householdId }, _max: { sortOrder: true } });
  await prisma.recurringItem.create({
    data: { householdId, kind, name, amount, categoryId: kind === "expense" ? categoryId : null, memberId, sortOrder: (max._max.sortOrder ?? 0) + 1, ...sched },
  });
  revalidateFamily();
}

export async function updateRecurringItem(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("id"));
  const item = await prisma.recurringItem.findUnique({ where: { id } });
  if (!item) return;
  const data: {
    amount?: number; name?: string; memberId?: number | null; categoryId?: number | null;
    intervalMonths?: number; installmentsTotal?: number | null;
    installmentStartYear?: number | null; installmentStartMonth?: number | null; dueDay?: number | null;
  } = {};
  if (formData.has("amount")) { const a = parseAmount(formData.get("amount")); if (a > 0) data.amount = a; }
  if (formData.has("name")) { const n = String(formData.get("name")).trim(); if (n) data.name = n; }
  if (formData.has("memberId")) data.memberId = formData.get("memberId") ? Number(formData.get("memberId")) : null;
  if (formData.has("categoryId") && item.kind === "expense" && formData.get("categoryId")) data.categoryId = Number(formData.get("categoryId"));
  if (formData.has("scheduleKind")) {
    const sched = await scheduleFromForm(item.householdId, formData);
    data.intervalMonths = sched.intervalMonths;
    data.installmentsTotal = sched.installmentsTotal;
    data.installmentStartYear = sched.installmentStartYear;
    data.installmentStartMonth = sched.installmentStartMonth;
    data.dueDay = sched.dueDay;
    if (sched.installmentsTotal && sched.intervalMonths === 1 && data.name) data.name = stripInstNumber(data.name);
  }
  await prisma.recurringItem.update({ where: { id }, data });
  revalidateFamily();
}

// Refresh the CURRENT open month from Setup: Setup is the source of truth for AMOUNTS + DUE DAYS, so
// every EXISTING template-generated line is re-pulled — recurring lines (income, monthly expenses,
// loans, chits, installments), budget envelopes (+ their Budget), and flat/periodic bills. It only
// UPDATES lines that are already there (matched to their Setup source); it never adds or removes a
// line, so hand-added one-offs, hand-removed lines, ✓ paid flags, spends and settlements are all
// left exactly as they are. A template line the family hand-edited IS re-pulled (Setup wins). For a
// preview month it also recomputes the carried surplus/estimate + over-budget cut from the working
// month (what the old "Refresh estimate" did). NOTE: bill-with-a-fund SHARE amounts (WiFi/EB/YouTube
// "monthly share") are schedule-computed from the fund, so they're not re-pulled here.
export async function syncMonthFromSetup(
  periodId: number,
): Promise<{ ok: boolean; updated: number; error?: string }> {
  if (!(await canEdit())) { log.warn("syncMonthFromSetup", "blocked", { periodId }); return { ok: false, updated: 0, error: "Not allowed." }; }
  const period = await prisma.period.findUnique({ where: { id: periodId }, select: { id: true, householdId: true, year: true, month: true, status: true } });
  if (!period) return { ok: false, updated: 0, error: "Month not found." };
  if (period.status !== "open") return { ok: false, updated: 0, error: "This month is closed." };
  const householdId = period.householdId;

  const [items, cats, incomes, expenses, budgets] = await Promise.all([
    prisma.recurringItem.findMany({ where: { householdId, active: true } }),
    prisma.category.findMany({ where: { householdId }, select: { id: true, name: true, onHold: true, monthlyBudget: true, fundingStyle: true, billEveryMonths: true, billDay: true, billAmount: true } }),
    prisma.incomeEntry.findMany({ where: { periodId, oneOff: false, note: null } }),
    prisma.expenseEntry.findMany({ where: { periodId, oneOff: false, note: null } }),
    prisma.budget.findMany({ where: { periodId } }),
  ]);
  const catById = new Map(cats.map((c) => [c.id, c]));
  // Budget envelopes & bills own their own line (generated from the Category, not a RecurringItem),
  // so their items are skipped in the recurring pass and handled by the category pass below.
  const selfGen = (categoryId: number | null): boolean => {
    if (categoryId == null) return false;
    const c = catById.get(categoryId);
    return !!c && (c.fundingStyle != null || c.billEveryMonths != null || (c.monthlyBudget != null && c.monthlyBudget > 0));
  };

  const usedInc = new Set<number>();
  const usedExp = new Set<number>();
  const updates: Prisma.PrismaPromise<unknown>[] = [];

  // 1. recurring lines (income + non-budgeted expenses: loans, chits, cook, misc, installments)
  for (const it of items) {
    if (it.kind === "income") {
      const cands = incomes.filter((e) => !usedInc.has(e.id) && e.ownerId === it.memberId);
      const match = cands.length === 1 ? cands[0] : cands.find((e) => stripInstNumber(e.source) === stripInstNumber(it.name));
      if (!match) continue;
      usedInc.add(match.id);
      if (match.pinned) continue; // month-pinned (edited on the Sheet) — don't revert to the Setup value
      if (match.dueDay !== it.dueDay || match.amount !== it.amount)
        updates.push(prisma.incomeEntry.update({ where: { id: match.id }, data: { dueDay: it.dueDay, amount: it.amount } }));
    } else {
      if (it.categoryId == null || selfGen(it.categoryId)) continue;
      const cands = expenses.filter((e) => !usedExp.has(e.id) && e.categoryId === it.categoryId && e.memberId === it.memberId);
      const match = cands.length === 1 ? cands[0] : cands.find((e) => stripInstNumber(e.label) === stripInstNumber(it.name));
      if (!match) continue;
      usedExp.add(match.id);
      if (match.pinned) continue; // month-pinned (edited on the Sheet) — don't revert to the Setup value
      if (match.dueDay !== it.dueDay || match.amount !== it.amount)
        updates.push(prisma.expenseEntry.update({ where: { id: match.id }, data: { dueDay: it.dueDay, amount: it.amount } }));
    }
  }

  // 2. budget envelopes + flat/periodic bills: one generated line per category — re-pull amount
  //    (and, for a bill, its due day) from the Category. Match the existing line by category.
  for (const cat of cats) {
    if (cat.onHold) continue;
    const line = expenses.find((e) => e.categoryId === cat.id && !usedExp.has(e.id));
    const isBudget = cat.fundingStyle == null && cat.billEveryMonths == null && cat.monthlyBudget != null && cat.monthlyBudget > 0;
    const isFullBill = cat.fundingStyle == null && cat.billEveryMonths != null && cat.billAmount != null && cat.billAmount > 0;
    if (isBudget) {
      usedExp.add(line?.id ?? -1);
      // A pinned envelope holds BOTH its numbers for the month — skip the Sheet line AND Budget.planned.
      if (line?.pinned) continue;
      if (line && line.amount !== cat.monthlyBudget) updates.push(prisma.expenseEntry.update({ where: { id: line.id }, data: { amount: cat.monthlyBudget! } }));
      const b = budgets.find((x) => x.categoryId === cat.id);
      if (b && b.planned !== cat.monthlyBudget) updates.push(prisma.budget.update({ where: { id: b.id }, data: { planned: cat.monthlyBudget! } }));
    } else if (isFullBill && line) {
      usedExp.add(line.id);
      if (line.pinned) continue; // month-pinned bill — keep the Sheet's amount / due-day
      if (line.amount !== cat.billAmount || line.dueDay !== cat.billDay) updates.push(prisma.expenseEntry.update({ where: { id: line.id }, data: { amount: cat.billAmount!, dueDay: cat.billDay } }));
    }
  }

  if (updates.length) await prisma.$transaction(updates);

  // 3. preview/provisional month → recompute the carried surplus/estimate + over-budget cut from the
  //    latest OPEN month strictly earlier than this one (a plain working month has none, so skip).
  const source = await prisma.period.findFirst({
    where: { householdId, status: "open", OR: [{ year: { lt: period.year } }, { year: period.year, month: { lt: period.month } }] },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { id: true, label: true, carryForward: true },
  });
  if (source) {
    await prisma.$transaction(async (tx) => {
      await addEstimatedCarry(tx, { id: source.id, label: source.label, householdId }, periodId);
      await addEstimatedSurplus(tx, { ...source, householdId }, periodId);
      await applyBudgetShortfall(tx, { id: source.id, householdId, carryForward: source.carryForward }, periodId);
    });
  }

  log.info("syncMonthFromSetup", "ok", { householdId, periodId, updated: updates.length, hadSource: !!source });
  revalidateFamily();
  return { ok: true, updated: updates.length };
}

// Un-pin a single Sheet line and re-pull its value from Setup — the inverse of a month-specific edit.
// Clears `pinned` and, in the same write, restores the amount/due-day the Setup template would give
// this line (budget → monthlyBudget, bill → billAmount/day, else the matching RecurringItem). Only
// THIS line is touched — other lines are left exactly as they are. HEAD/manager, open month only.
export async function unpinLine(formData: FormData) {
  if (!(await canEdit())) return { ok: false, error: "Not allowed." };
  const kind = String(formData.get("kind") ?? ""); // "income" | "expense"
  const id = Number(formData.get("id"));
  if (!id || (kind !== "income" && kind !== "expense")) return { ok: false, error: "Bad request." };

  if (kind === "income") {
    const inc = await prisma.incomeEntry.findUnique({ where: { id }, select: { ownerId: true, source: true, period: { select: { id: true, householdId: true, status: true } } } });
    if (!inc || inc.period.status !== "open") return { ok: false, error: "This month is closed." };
    const items = await prisma.recurringItem.findMany({ where: { householdId: inc.period.householdId, active: true, kind: "income" } });
    const cands = items.filter((it) => it.memberId === inc.ownerId);
    const it = cands.length === 1 ? cands[0] : cands.find((x) => stripInstNumber(x.name) === stripInstNumber(inc.source));
    await prisma.incomeEntry.update({ where: { id }, data: { pinned: false, ...(it ? { amount: it.amount, dueDay: it.dueDay } : {}) } });
    revalidateFamily();
    return { ok: true };
  }

  const exp = await prisma.expenseEntry.findUnique({
    where: { id },
    select: { categoryId: true, memberId: true, label: true, paid: true, period: { select: { id: true, householdId: true, status: true } },
      category: { select: { fundingStyle: true, billEveryMonths: true, billDay: true, billAmount: true, monthlyBudget: true, onHold: true } } },
  });
  if (!exp || exp.period.status !== "open") return { ok: false, error: "This month is closed." };
  if (exp.paid) return { ok: false, error: "This is already paid — it can’t be re-synced." };
  const cat = exp.category;
  const isBudget = cat.fundingStyle == null && cat.billEveryMonths == null && cat.monthlyBudget != null && cat.monthlyBudget > 0;
  const isFullBill = cat.fundingStyle == null && cat.billEveryMonths != null && cat.billAmount != null && cat.billAmount > 0;
  if (isBudget) {
    await prisma.$transaction([
      prisma.expenseEntry.update({ where: { id }, data: { pinned: false, amount: cat.monthlyBudget! } }),
      prisma.budget.updateMany({ where: { periodId: exp.period.id, categoryId: exp.categoryId }, data: { planned: cat.monthlyBudget! } }),
    ]);
  } else if (isFullBill) {
    await prisma.expenseEntry.update({ where: { id }, data: { pinned: false, amount: cat.billAmount!, dueDay: cat.billDay } });
  } else {
    // non-budget recurring line (loan/chit/cook/misc): match the template by category + payer + name
    const items = await prisma.recurringItem.findMany({ where: { householdId: exp.period.householdId, active: true, kind: "expense", categoryId: exp.categoryId } });
    const cands = items.filter((x) => x.memberId === exp.memberId);
    const it = cands.length === 1 ? cands[0] : cands.find((x) => stripInstNumber(x.name) === stripInstNumber(exp.label));
    await prisma.expenseEntry.update({ where: { id }, data: { pinned: false, ...(it ? { amount: it.amount, dueDay: it.dueDay } : {}) } });
  }
  revalidateFamily();
  return { ok: true };
}

// Set the DAY of a dated Money-plan step from the plan itself (head-only) — the "click the date →
// pick a day" dropdown. Writes to the step's underlying row so it survives a refresh: a bill /
// allowance / income line's day is set AND pinned (a Setup sync won't revert it); an advance leg's
// day is set on the Advance record. `day` empty/0 clears it (undated → sorts last). Not the derived
// transfer/collection steps — those have no stored day of their own (they follow bills + liquidity).
export async function setStepDay(formData: FormData) {
  if (!(await isHead())) return { ok: false, error: "Only the head can change a step's date." };
  const kind = String(formData.get("kind") ?? "");
  const id = Number(formData.get("id"));
  const raw = formData.get("day");
  const n = raw == null || String(raw) === "" ? null : Number(raw);
  const day = n == null || !Number.isFinite(n) ? null : Math.min(31, Math.max(1, Math.round(n)));
  if (!id) return { ok: false, error: "Bad request." };

  // Dates are editable in the OPEN month AND the next-month PREVIEW draft (so the head can pre-arrange
  // the plan before it goes live). Only a CLOSED month is frozen.
  if (kind === "bill" || kind === "allowance") {
    const e = await prisma.expenseEntry.findUnique({ where: { id }, select: { paid: true, period: { select: { status: true } } } });
    if (!e || e.period.status === "closed") return { ok: false, error: "This month is closed." };
    if (e.paid) return { ok: false, error: "This is already paid — its date can’t be changed." };
    await prisma.expenseEntry.update({ where: { id }, data: { dueDay: day, pinned: true } });
  } else if (kind === "income") {
    const i = await prisma.incomeEntry.findUnique({ where: { id }, select: { period: { select: { status: true } } } });
    if (!i || i.period.status === "closed") return { ok: false, error: "This month is closed." };
    await prisma.incomeEntry.update({ where: { id }, data: { dueDay: day, pinned: true } });
  } else if (kind === "advance" || kind === "advance-payback") {
    const a = await prisma.advance.findUnique({ where: { id }, select: { settled: true, paybackSettled: true } });
    if (!a) return { ok: false, error: "Not found." };
    const payback = kind === "advance-payback";
    if (payback ? a.paybackSettled : a.settled) return { ok: false, error: "This is already done — its date can’t be changed." };
    await prisma.advance.update({ where: { id }, data: payback ? { paybackDay: day } : { day } });
  } else if (kind === "override") {
    // A step with no row of its own (fund/periodic bill, Piggy hand-over): store the day in the
    // StepDayOverride table keyed by the step's stable key. Clearing it (no day) deletes the row so
    // the step falls back to its derived date. `id` here is the periodId the override belongs to.
    const stepKey = String(formData.get("stepKey") ?? "");
    if (!stepKey) return { ok: false, error: "Bad request." };
    const period = await prisma.period.findUnique({ where: { id }, select: { status: true } });
    if (!period || period.status === "closed") return { ok: false, error: "This month is closed." };
    if (day == null) await prisma.stepDayOverride.deleteMany({ where: { periodId: id, stepKey } });
    else await prisma.stepDayOverride.upsert({ where: { periodId_stepKey: { periodId: id, stepKey } }, create: { periodId: id, stepKey, day }, update: { day } });
  } else if (kind === "manual") {
    // A head-added manual step owns its own day (positioning still follows its insert anchor, so the
    // date is display + fallback order). Editable even once ticked done — it's ad-hoc metadata.
    const m = await prisma.manualPlanStep.findUnique({ where: { id }, select: { period: { select: { status: true } } } });
    if (!m || m.period.status === "closed") return { ok: false, error: "This month is closed." };
    await prisma.manualPlanStep.update({ where: { id }, data: { day } });
  } else {
    return { ok: false, error: "This step's date can’t be edited." };
  }
  revalidateFamily();
  return { ok: true };
}

// The setStepDay params that drive a plan step's date (mirrors the Money-Plan date editor): a row-backed
// step edits its own row; a rowless one (fund/periodic, hand-over) uses a per-month override. null for
// DERIVED steps (collections/disbursements/budget loans) — they have no date of their own.
function stepDayParamsFor(s: import("@/lib/moneyPlan").PlanStep, periodId: number): { kind: string; id: number; stepKey?: string } | null {
  if (s.kind === "manual") return s.manualId != null ? { kind: "manual", id: s.manualId } : null;
  const rowId = s.kind === "income" ? s.incomeId : (s.kind === "bill" && !s.fund) || s.kind === "allowance" ? s.billId : s.kind === "advance" ? s.advanceId : undefined;
  if (rowId != null) return { kind: s.kind === "advance" ? (s.payback ? "advance-payback" : "advance") : s.kind, id: rowId };
  const stepKey =
    s.kind === "piggy" && s.handoverPeriodId != null && s.fromId != null ? `piggyho-${s.handoverPeriodId}-${s.fromId}`
      : s.kind === "pool-handover" && s.fromId != null ? `poolho-${s.fromId}`
        : s.kind === "bill" && s.fund && s.categoryId != null ? `fund-${s.categoryId}`
          : undefined;
  return stepKey != null ? { kind: "override", id: periodId, stepKey } : null;
}

// Head "move up / down". WITHIN a day → a positional swap with the neighbour (persist the whole order so
// the plan recomputes in it — balances/short flags re-derive). At a DAY BOUNDARY (the step is first/last
// of its day) → change the step's DATE to the neighbour's day, if its date is editable; otherwise fall
// back to a positional swap. Keyed by the step's id (PlanStep.id).
export async function moveStep(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  if (!(await isHead())) return { ok: false, error: "Only the head can reorder steps." };
  const periodId = Number(formData.get("periodId"));
  const stepKey = String(formData.get("stepKey") ?? "");
  const dir = String(formData.get("dir") ?? "");
  if (!periodId || !stepKey || (dir !== "up" && dir !== "down")) return { ok: false, error: "Bad request." };
  const period = await prisma.period.findUnique({ where: { id: periodId }, select: { householdId: true, status: true } });
  if (!period || period.status === "closed") return { ok: false, error: "This month is closed." };

  const plan = await getMoneyPlan(period.householdId, periodId);
  const visible = plan.steps.filter((s) => !s.hidden);
  const vi = visible.findIndex((s) => s.id === stepKey);
  if (vi < 0) return { ok: false, error: "Step not found." };
  const vj = dir === "up" ? vi - 1 : vi + 1;
  if (vj < 0 || vj >= visible.length) return { ok: true }; // top/bottom of the whole plan — no-op
  const moved = visible[vi];
  const neighbor = visible[vj];

  // DAY BOUNDARY: moved is first/last of its day (neighbour sits on a different day). Change its date to
  // the neighbour's day, if editable — that's the "date also changes" behaviour. Clear any stale order
  // override so it sorts naturally in its new day. (Done/paid steps and derived steps fall through to swap.)
  const sameDay = (moved.day ?? null) === (neighbor.day ?? null);
  if (!sameDay && neighbor.day != null && !moved.done) {
    const p = stepDayParamsFor(moved, periodId);
    if (p) {
      const fd = new FormData();
      fd.set("kind", p.kind);
      fd.set("id", String(p.id));
      if (p.stepKey) fd.set("stepKey", p.stepKey);
      fd.set("day", String(neighbor.day));
      const r = await setStepDay(fd);
      if (!r.ok) return r;
      await prisma.stepOrderOverride.deleteMany({ where: { periodId, stepKey } });
      revalidateFamily();
      return { ok: true };
    }
  }

  // WITHIN A DAY (or a non-editable boundary cross): swap the two ids in the full order, renumber EVERY
  // step so the manual order is fully consistent (steps with no row fall back to their derived slot).
  const order = plan.steps.map((s) => s.id);
  const ai = order.indexOf(moved.id);
  const aj = order.indexOf(neighbor.id);
  [order[ai], order[aj]] = [order[aj], order[ai]];
  await prisma.$transaction([
    prisma.stepOrderOverride.deleteMany({ where: { periodId } }),
    prisma.stepOrderOverride.createMany({ data: order.map((id, idx) => ({ periodId, stepKey: id, sortIndex: idx })) }),
  ]);
  revalidateFamily();
  return { ok: true };
}

// Batch-save the recurring template rows edited in Setup (one floating "N changes → Save" bar).
export async function saveAllRecurringItems(
  prev: SaveRecurringState,
  formData: FormData,
): Promise<SaveRecurringState> {
  const n = (prev?.n ?? 0) + 1;
  if (!(await isHead())) return { ok: false, error: "Only the head can edit setup.", n };
  let rows: Record<string, string>[];
  try {
    rows = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { ok: false, error: "Couldn't read the changes.", n };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true, n };

  for (const r of rows) {
    const id = Number(r.id);
    if (!id) continue;
    const item = await prisma.recurringItem.findUnique({ where: { id } });
    if (!item) continue;
    const name = String(r.name ?? "").trim();
    if (!name) return { ok: false, error: "Every row needs a name.", n };
    const amount = parseAmount(r.amount);
    if (!amount || amount <= 0) return { ok: false, error: `${name}: amount must be more than 0.`, n };

    const fd = new FormData();
    fd.set("scheduleKind", String(r.scheduleKind ?? "monthly"));
    if (r.dueDay) fd.set("dueDay", String(r.dueDay));
    if (r.installmentsTotal) fd.set("installmentsTotal", String(r.installmentsTotal));
    if (r.installmentCurrent) fd.set("installmentCurrent", String(r.installmentCurrent));
    const sched = await scheduleFromForm(item.householdId, fd);
    // Editing an installment must NOT move its start month (which would re-baseline the schedule — and
    // a not-yet-started EMI has current=0, which the recompute would wrongly read as "starts this
    // month"). Preserve the stored start for an existing installment; only a brand-new one (monthly →
    // installment) gets anchored to next month.
    if (sched.installmentsTotal != null) {
      const wasInstallment = item.installmentsTotal != null && item.intervalMonths <= 1 && item.installmentStartYear != null;
      const start = wasInstallment
        ? { installmentStartYear: item.installmentStartYear, installmentStartMonth: item.installmentStartMonth }
        : await installmentStartAnchored(item.householdId, sched.installmentsTotal, false);
      sched.installmentStartYear = start.installmentStartYear;
      sched.installmentStartMonth = start.installmentStartMonth;
    }

    const finalName = sched.installmentsTotal && sched.intervalMonths === 1 ? stripInstNumber(name) : name;
    await prisma.recurringItem.update({
      where: { id },
      data: {
        name: finalName,
        amount,
        memberId: r.memberId ? Number(r.memberId) : null,
        categoryId: item.kind === "expense" && r.categoryId ? Number(r.categoryId) : item.categoryId,
        intervalMonths: sched.intervalMonths,
        installmentsTotal: sched.installmentsTotal,
        installmentStartYear: sched.installmentStartYear,
        installmentStartMonth: sched.installmentStartMonth,
        dueDay: sched.dueDay,
      },
    });
  }
  log.info("saveAllRecurringItems", "ok", { count: rows.length });
  revalidateFamily();
  return { ok: true, n };
}

export async function deleteRecurringItem(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("id"));
  await prisma.recurringItem.deleteMany({ where: { id } });
  revalidateFamily();
}

export async function toggleRecurringActive(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("id"));
  const item = await prisma.recurringItem.findUnique({ where: { id } });
  if (!item) return;
  await prisma.recurringItem.update({ where: { id }, data: { active: !item.active } });
  revalidateFamily();
}

// Throw the draft away entirely.
export async function discardDraft(formData: FormData) {
  if (!(await canEdit())) return; // head + manager
  const periodId = Number(formData.get("periodId"));
  const draft = await prisma.period.findUnique({ where: { id: periodId } });
  if (!draft || draft.status !== "draft") return;
  await prisma.$transaction(async (tx) => {
    await clearPeriodRows(tx, periodId);
    await tx.period.delete({ where: { id: periodId } });
  });
  revalidateFamily();
  redirect("/");
}

// derive a short member code from a name (initials, else first letters)
function deriveCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

// Member management (head-only). useActionState-shaped for toast feedback.
// Email is set only at creation (it's the login whitelist); edits change name/code/role/email.
export type SaveMemberState = { ok: boolean; error?: string; n: number };

export async function saveMember(
  prev: SaveMemberState,
  formData: FormData,
): Promise<SaveMemberState> {
  const n = (prev?.n ?? 0) + 1;
  if (!(await isHead())) return { ok: false, error: "Only the head can manage members.", n };
  const id = formData.get("id") ? Number(formData.get("id")) : null;
  const householdId = Number(formData.get("householdId"));
  const name = String(formData.get("name") ?? "").trim();
  const codeRaw = String(formData.get("code") ?? "").trim();
  const role = String(formData.get("role") ?? "member");
  const code = (codeRaw || deriveCode(name)).toUpperCase();

  if (!name) return { ok: false, error: "Name is required.", n };

  try {
    if (id) {
      // Head may set/clear a member's Google email here to grant/revoke sign-in.
      const emailRaw = String(formData.get("email") ?? "").trim().toLowerCase();
      await prisma.member.update({
        where: { id },
        data: { name, code, role, email: emailRaw || null },
      });
    } else {
      const email = String(formData.get("email") ?? "").trim().toLowerCase();
      if (!householdId || !email) return { ok: false, error: "Email is required to add a member.", n };
      await prisma.member.create({
        data: { householdId, name, code, role, email, isEarner: true },
      });
    }
  } catch {
    return { ok: false, error: "That email or code is already taken.", n };
  }
  revalidateFamily();
  return { ok: true, n };
}

// Remove a member from the household (head-only). Detaches their entry attributions
// first so we don't violate FK constraints. Can't delete yourself or the last head.
export async function deleteMember(formData: FormData) {
  const session = await auth();
  if (session?.user?.role !== "head") return;
  const id = Number(formData.get("id"));
  if (!id) return;
  if (session.user.memberId === id) return; // can't delete self

  const member = await prisma.member.findUnique({ where: { id } });
  if (!member) return;
  if (member.role === "head") {
    const heads = await prisma.member.count({
      where: { householdId: member.householdId, role: "head" },
    });
    if (heads <= 1) return; // keep at least one head
  }

  await prisma.$transaction([
    prisma.expenseEntry.updateMany({ where: { memberId: id }, data: { memberId: null } }),
    prisma.incomeEntry.updateMany({ where: { ownerId: id }, data: { ownerId: null } }),
    prisma.member.delete({ where: { id } }),
  ]);
  revalidateFamily();
}

// Month close:
//  • each tracked, budgeted category's (budget − spent) → its Piggy (variable) or Hold (sinking)
//  • Misc (tracked, no budget) total → deducted from NEXT month's income
//  • month balance (carryIn + income − expense) carries forward; next month is cloned & locked
export async function windDownMonth(formData: FormData) {
  if (!(await canEdit())) return; // head or manager
  const periodId = Number(formData.get("periodId"));
  if (!periodId) return;
  // Opt-in at wind-down: route THIS month's under-budget leftovers (the general-Piggy
  // contribution) into NEXT month's income instead of parking them in the Piggy bank.
  const leftoversToIncome = formData.get("leftoversToIncome") === "1";
  await windDownPeriod(periodId, { leftoversToIncome });
  revalidateFamily();
}

// Mark a wound-down month's Piggy leftover as physically handed from the category owners to the
// Piggy holder (the tickable hand-over step in the next month's Money Plan). `undo` clears it back
// to pending. Head/manager only. Flips whether that lump sits in the owners' In-Hand vs the holder's.
export async function markPiggyHandedOver(formData: FormData) {
  if (!(await canEdit())) return;
  const periodId = Number(formData.get("periodId"));
  if (!periodId) return;
  const undo = formData.get("undo") === "1";
  await prisma.period.update({ where: { id: periodId }, data: { piggyHandedOverAt: undo ? null : new Date() } });
  await logActivity("piggy", "updated", `${undo ? "Reverted" : "Confirmed"} last month's Piggy hand-over`, periodId);
  revalidateFamily();
}
