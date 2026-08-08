"use server";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { auth, signOut } from "@/auth";
import { isUnlocked } from "@/lib/applock";
import { log } from "@/lib/log";
import { formatINR, parseAmount } from "@/lib/format";
import { generateMonth } from "@/lib/periodClone";
import { isMiscBucket, MISC_SUBCATEGORIES } from "@/lib/misc";
import { isLearnable } from "@/lib/spendCategorize";
import { getSpendShortcuts, getMatcherKeywords, getFrequentSpendItems, getMoneyPlan } from "@/lib/queries";
import { planBillMonth, type FundingStyle } from "@/lib/schedule";
import { getBillReminders } from "@/lib/billReminders";
import { applyBudgetShortfall, windDownPeriod } from "@/lib/windDown";
import { SURPLUS_NOTE, CARRY_NOTE, DEFERRED_NOTE } from "@/lib/notes";

// Record a money-affecting change for the head-only activity log (who + what + when).
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
  revalidatePath("/", "layout");
}

export async function doSignOut() {
  await signOut({ redirectTo: "/signin" });
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
export type FundSource = { memberId: number; name: string; spare: number };
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
    await prisma.recurringItem.update({ where: { id: existing.id }, data: { amount, memberId, active: true } });
  } else {
    const max = await prisma.recurringItem.aggregate({ where: { householdId }, _max: { sortOrder: true } });
    await prisma.recurringItem.create({
      data: { householdId, kind, name, amount, categoryId: kind === "expense" ? categoryId : null, memberId, sortOrder: (max._max.sortOrder ?? 0) + 1 },
    });
  }
}

// Add-expense timing gate: would a NEW dated expense make the money plan unpayable? Simulates the
// plan with the expense injected (not persisted) and blocks only if it introduces a shortfall that
// wasn't already there — the payer can't cover it in time, the treasurer runs short, or a disbursement
// gets pushed past its due day. Undated expenses have no timing deadline, so they're never gated here.
async function checkAddExpenseFeasible(
  periodId: number,
  hyp: { amount: number; dueDay: number | null; payerId: number | null; label: string },
): Promise<{ ok: true } | { ok: false; reason: string; shortfall?: SaveShortfall; sources?: FundSource[] }> {
  if (hyp.dueDay == null) return { ok: true };
  const period = await prisma.period.findUnique({ where: { id: periodId }, select: { householdId: true } });
  if (!period) return { ok: true };
  const hh = period.householdId;
  const members = await prisma.member.findMany({ where: { householdId: hh }, select: { id: true, name: true } });
  const payerName = members.find((m) => m.id === hyp.payerId)?.name ?? "Shared";
  const hypBill = { key: "__hyp__", payerId: hyp.payerId, payerName, vendor: hyp.label, amount: hyp.amount, done: false, day: hyp.dueDay, status: null, days: null };
  const [base, withHyp] = await Promise.all([getMoneyPlan(hh, periodId), getMoneyPlan(hh, periodId, undefined, [hypBill])]);
  const inr = (n: number) => formatINR(Math.round(n));
  // 1. the expense's own payer can't cover it by its due day → offer to fund it from whoever holds
  //    spare cash right before that step (the dropdown of sources the user picks from).
  const hypStep = withHyp.steps.find((s) => s.id === "__hyp__");
  if (hypStep?.senderShort != null && hypStep.senderShort > 0.5) {
    const sources: FundSource[] =
      hyp.payerId == null
        ? []
        : members
            .filter((m) => m.id !== hyp.payerId)
            .map((m) => ({ memberId: m.id, name: m.name, spare: Math.round(hypStep.balancesBefore?.[m.id] ?? 0) }))
            .filter((s) => s.spare > 0.5)
            .sort((a, b) => b.spare - a.spare);
    return {
      ok: false,
      reason: `${payerName} would be short ${inr(hypStep.senderShort)} on day ${hyp.dueDay}.`,
      shortfall: hyp.payerId == null ? undefined : { toMemberId: hyp.payerId, toName: payerName, amount: Math.round(hypStep.senderShort), day: hyp.dueDay },
      sources,
    };
  }
  // 2. it makes the treasurer/hub short (money not collected in time)
  if (withHyp.hubShortfall > base.hubShortfall + 0.5)
    return { ok: false, reason: `This would leave the treasurer short ${inr(withHyp.hubShortfall)} — the money isn't collected by then. Try a later due date.` };
  // 3. it pushes some disbursement past its due day (unfundable in time)
  const baseInf = new Set(base.steps.filter((s) => s.infeasibleFrom !== undefined).map((s) => s.id));
  const newInf = withHyp.steps.find((s) => s.infeasibleFrom !== undefined && !baseInf.has(s.id));
  if (newInf)
    return { ok: false, reason: newInf.infeasibleFrom == null ? `Adding this leaves a payment that can't be funded this month.` : `Adding this pushes a payment past its due day — it can't be funded until day ${newInf.infeasibleFrom}. Try a later due date.` };
  return { ok: true };
}

// Create (no id) or update (id present). Head/Manager; head may edit closed months.
// Returns {ok} on success, or {ok:false, error} with a reason the UI can show. Note (label) is REQUIRED.
async function doSaveExpense(formData: FormData): Promise<{ ok: boolean; error?: string; shortfall?: SaveShortfall; sources?: FundSource[] }> {
  if (!(await canEdit())) return { ok: false };

  const id = formData.get("id") ? Number(formData.get("id")) : null;
  const periodId = Number(formData.get("periodId"));
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
    const existing = await prisma.expenseEntry.findUnique({ where: { id }, select: { paid: true, amount: true, dueDay: true } });
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
    if (!deferred && !funding) {
      const feas = await checkAddExpenseFeasible(periodId, { amount, dueDay, payerId: finalMemberId, label });
      if (!feas.ok) return { ok: false, error: feas.reason, shortfall: feas.shortfall, sources: feas.sources };
    }
    // "Repeat every month" (checkbox) → also add to the recurring template so it's generated every
    // month; unchecked → one-off (this month only). A deferred line is always one-off.
    const oneOff = deferred || formData.get("repeat") !== "on";
    await prisma.expenseEntry.create({
      data: { periodId, categoryId, amount, label, memberId: finalMemberId, necessary, oneOff, dueDay, ...(deferred ? { note: DEFERRED_NOTE } : {}) },
    });
    if (!oneOff) await promoteToTemplate(periodId, "expense", label, amount, categoryId, finalMemberId);
    // Record the funding advances (one per funder) so each front + payback appears in the plan.
    if (funding && finalMemberId != null) {
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
  revalidatePath("/", "layout");
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

  if (!periodId || !source || !amount) return false;
  if (!(await canEditNow(periodId))) return false;

  // "Repeat every month" → also add to the recurring template; unchecked → one-time
  const oneOff = formData.get("repeat") !== "on";
  await prisma.incomeEntry.create({ data: { periodId, source, amount, ownerId, oneOff } });
  if (!oneOff) await promoteToTemplate(periodId, "income", source, amount, null, ownerId);
  await logActivity("income", "created", `Added income “${source}” ${formatINR(amount)}`, periodId);
  revalidatePath("/", "layout");
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
  if (!id || !source || !amount) return { ok: false, n: prev.n };
  const i = await prisma.incomeEntry.findUnique({ where: { id } });
  if (!i || !(await canEditNow(i.periodId))) return { ok: false, n: prev.n };
  // A month-specific amount edit pins the line so a refresh-from-Setup won't revert it (until un-pinned).
  const pin = i.amount !== amount ? { pinned: true } : {};
  await prisma.incomeEntry.update({ where: { id }, data: { source, amount, ownerId, ...pin } });
  await logActivity("income", "updated", `Edited income “${source}” to ${formatINR(amount)}`, i.periodId);
  revalidatePath("/", "layout");
  return { ok: true, n: prev.n + 1 };
}

export async function deleteExpense(formData: FormData) {
  if (!(await canEdit())) return;
  const id = Number(formData.get("id"));
  if (!id) return;
  const e = await prisma.expenseEntry.findUnique({ where: { id } });
  if (e && !(await canEditNow(e.periodId))) return;
  if (e?.paid) return; // a line already paid in the money plan is frozen — paid is paid
  await prisma.expenseEntry.delete({ where: { id } });
  if (e) await logActivity("expense", "deleted", `Removed expense “${e.label}” ${formatINR(e.amount)}`, e.periodId);
  revalidatePath("/", "layout");
}

export async function deleteIncome(formData: FormData) {
  if (!(await canEdit())) return;
  const id = Number(formData.get("id"));
  if (!id) return;
  const i = await prisma.incomeEntry.findUnique({ where: { id } });
  if (i && !(await canEditNow(i.periodId))) return;
  await prisma.incomeEntry.delete({ where: { id } });
  if (i) await logActivity("income", "deleted", `Removed income “${i.source}” ${formatINR(i.amount)}`, i.periodId);
  revalidatePath("/", "layout");
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
async function doAddSpend(formData: FormData): Promise<boolean> {
  const session = await auth();
  const selfId = session?.user?.memberId;
  if (!selfId) return false; // must be a mapped member
  await requireUnlocked("deleteIncome");

  const periodId = Number(formData.get("periodId"));
  const categoryId = Number(formData.get("categoryId"));
  const amount = parseAmount(formData.get("amount"));
  const label = String(formData.get("label") ?? "").trim();

  if (!periodId || !categoryId || !amount || !label) return false;
  if (!(await periodOpen(periodId))) return false;

  // Misc (Personal/Misc) spends must carry a reporting sub-category (Food, Travel…);
  // other categories already are a category, so it stays null there.
  const subCategoryRaw = String(formData.get("subCategory") ?? "").trim();
  const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { section: true, tracked: true, householdId: true } });
  const misc = cat ? isMiscBucket(cat) : false;
  if (misc && !subCategoryRaw) return false; // mandatory for misc
  const subCategory = misc && subCategoryRaw ? subCategoryRaw : null;

  // Only the head may log a spend on behalf of another member; everyone else = self.
  const overrideId = Number(formData.get("memberId")) || 0;
  const memberId = overrideId && session?.user?.role === "head" ? overrideId : selfId;

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
  await prisma.spend.create({
    data: { periodId: targetPeriodId, categoryId, memberId, label, amount, subCategory, imagePath },
  });
  // Learn the item→category so future entries of the same thing get suggested. Only
  // deliberate tracked (non-misc) categorisations teach the app — misc is ambiguous
  // (the same item can be "for someone else"), so we never learn from it.
  if (cat && cat.tracked && !misc) await learnSpendItem(cat.householdId, label, categoryId);
  await logActivity("spend", "created", `Logged spend “${label}” ${formatINR(amount)}`, targetPeriodId);
  revalidatePath("/", "layout");
  return true;
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
};
export async function getSpendAssist(): Promise<SpendAssist> {
  const session = await auth();
  if (!session?.user) return { chips: [], keywords: [] };
  const household = await prisma.household.findFirst({ select: { id: true } });
  if (!household) return { chips: [], keywords: [] };
  const [shortcuts, keywords] = await Promise.all([
    getSpendShortcuts(household.id),
    getMatcherKeywords(household.id),
  ]);
  const chips = shortcuts.length
    ? shortcuts.map((s) => ({ icon: s.icon, label: s.label, categoryId: s.categoryId }))
    : (await getFrequentSpendItems(household.id)).map((f) => ({ icon: f.icon, label: f.label, categoryId: f.categoryId }));
  return { chips, keywords };
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
}

export async function deleteSpendShortcut(formData: FormData) {
  const household = await shortcutHousehold();
  if (!household) return;
  const id = Number(formData.get("id"));
  const sc = await prisma.spendShortcut.findUnique({ where: { id } });
  if (!sc || sc.householdId !== household.id) return;
  await prisma.spendShortcut.delete({ where: { id } });
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
}

// Plain form-action caller (card mode on the Expenses page): fire-and-forget.
export async function addSpend(formData: FormData) {
  await doAddSpend(formData);
}

// useActionState caller (the quick-entry modal): returns a success signal so the
// UI can show "Saved ✓" and reset for the next item without closing. `n`
// increments on each successful save and drives the client-side reset effect.
export type AddSpendState = { ok: boolean; n: number };
export async function addSpendAction(
  prev: AddSpendState,
  formData: FormData,
): Promise<AddSpendState> {
  const ok = await doAddSpend(formData);
  return { ok, n: ok ? prev.n + 1 : prev.n };
}

// The spend's owner can delete their own; the head can delete anyone's.
export async function deleteSpend(formData: FormData) {
  const session = await auth();
  if (!session?.user) return;
  await requireUnlocked("deleteSpend");
  const id = Number(formData.get("id"));
  if (!id) return;
  const spend = await prisma.spend.findUnique({ where: { id } });
  if (!spend) return;
  if (!(await periodOpen(spend.periodId))) return;

  const isOwner = spend.memberId === session.user.memberId;
  if (session.user.role !== "head" && !isOwner) return;

  // (Receipt files are deferred/cloud-stored — nothing to unlink locally.)
  await prisma.spend.delete({ where: { id } });
  await logActivity("spend", "deleted", `Removed spend “${spend.label}” ${formatINR(spend.amount)}`, spend.periodId);
  revalidatePath("/", "layout");
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

  const valid = MISC_SUBCATEGORIES.some((s) => s.name === value);
  await prisma.spend.update({ where: { id }, data: { subCategory: valid ? value : null } });
  revalidatePath("/", "layout");
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

  const spend = await prisma.spend.findUnique({ where: { id }, include: { category: { select: { section: true, tracked: true } } } });
  if (!spend) return prev;
  if (!(await periodOpen(spend.periodId))) return prev;

  const isHead = session.user.role === "head";
  const isOwner = spend.memberId === session.user.memberId;
  if (!isHead && !isOwner) return prev;

  // misc spends must keep a sub-category; non-misc stay null
  const misc = isMiscBucket(spend.category);
  const subRaw = String(formData.get("subCategory") ?? "").trim();
  if (misc && !MISC_SUBCATEGORIES.some((s) => s.name === subRaw)) return prev;
  const subCategory = misc ? subRaw : null;

  // Only the head may reassign who spent (incl. "Shared" = null); the owner's stays put.
  // Non-head has no selector, so its field is absent → keep the existing attribution.
  let memberId = spend.memberId;
  if (isHead && formData.has("memberId")) {
    const raw = String(formData.get("memberId") ?? "");
    memberId = raw === "" ? null : Number(raw) || null;
  }

  // createdAt is intentionally left untouched — the date of spend stays as it was.
  await prisma.spend.update({ where: { id }, data: { label, amount, subCategory, memberId } });
  await logActivity("spend", "updated", `Edited spend “${label}” ${formatINR(amount)}`, spend.periodId);
  revalidatePath("/", "layout");
  return { ok: true, n: prev.n + 1 };
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
    // 2. one-off income line (money brought into the month; not copied forward)
    await tx.incomeEntry.create({
      data: { periodId, source: `From Piggy: ${note}`, amount, oneOff: true },
    });
  });
  await logActivity("piggy", "updated", `Used Piggy ${formatINR(amount)} — ${note}`, periodId);
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
  return { ok: true, n };
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
  revalidatePath("/", "layout");
}

// Pause / resume a category (skipped from new-month seeding & wind-down while held).
export async function toggleHold(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("categoryId"));
  if (!id) return;
  const cat = await prisma.category.findUnique({ where: { id } });
  if (!cat) return;
  await prisma.category.update({ where: { id }, data: { onHold: !cat.onHold } });
  revalidatePath("/", "layout");
}

// Per-bill reminder toggle: mute/unmute the due popup for one bill (head-only).
export async function toggleRemind(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("categoryId"));
  if (!id) return;
  const cat = await prisma.category.findUnique({ where: { id }, select: { remind: true } });
  if (!cat) return;
  await prisma.category.update({ where: { id }, data: { remind: !cat.remind } });
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
}

// Mark / unmark a bill as paid — head/manager, on an open month. A paid bill drops out
// of "budget left in hand" (that cash went out) and into the "Paid this month" list.
export async function toggleBillPaid(formData: FormData) {
  const session = await auth();
  const memberId = session?.user?.memberId ?? null;
  if (!(await unlocked())) await relock("toggleBillPaid");
  const id = Number(formData.get("id"));
  const e = await prisma.expenseEntry.findUnique({ where: { id } });
  if (!e) { log.warn("toggleBillPaid", "blocked", { outcome: "blocked", reason: "not-found", memberId, id }); return; }
  // Marking a bill paid TRACKS REALITY — it doesn't change the planned sheet, so the settlement
  // lock (which freezes planned numbers) must NOT apply here, or a manager gets blocked while a
  // member-payer isn't. Head + manager + the bill's own payer may toggle it; head may do any
  // month, everyone else only while the month is still open.
  const isEditor = await canEdit(); // head or manager (and unlocked)
  const isPayer = memberId != null && memberId === e.memberId;
  if (!isEditor && !isPayer) { log.warn("toggleBillPaid", "blocked", { outcome: "blocked", reason: "not-allowed", memberId, id, periodId: e.periodId }); return; }
  if (!(await isHead()) && !(await periodOpen(e.periodId))) { log.warn("toggleBillPaid", "blocked", { outcome: "blocked", reason: "period-closed", memberId, id, periodId: e.periodId }); return; }
  await prisma.expenseEntry.update({ where: { id }, data: { paid: !e.paid } });
  log.info("toggleBillPaid", "ok", { outcome: "ok", memberId, id, paid: !e.paid, periodId: e.periodId });
  revalidatePath("/", "layout");
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
    revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  if (!householdId || !periodId || !fromMemberId || !toMemberId || !amount) return;
  await requireUnlocked("markSettled");
  // head, OR the payer/receiver of THIS transfer, may mark it settled
  const me = session?.user?.memberId;
  const allowed = session?.user?.role === "head" || me === fromMemberId || me === toMemberId;
  if (!allowed) return;

  await prisma.settlementRecord.upsert({
    where: { periodId_fromMemberId_toMemberId: { periodId, fromMemberId, toMemberId } },
    update: { amount, note, settledById: session?.user?.memberId ?? null, settledAt: new Date() },
    create: {
      householdId,
      periodId,
      fromMemberId,
      toMemberId,
      amount,
      note,
      settledById: session?.user?.memberId ?? null,
    },
  });
  await logActivity("settlement", "created", `Marked a settlement paid (${formatINR(amount)})`, periodId);
  revalidatePath("/", "layout");
}

// Undo a recorded settlement. Head-only.
export async function unsettle(formData: FormData) {
  const session = await auth();
  const id = Number(formData.get("id"));
  if (!id) return;
  const rec = await prisma.settlementRecord.findUnique({ where: { id } });
  if (!rec) return;
  await requireUnlocked("unsettle");
  const me = session?.user?.memberId;
  // head, OR the payer/receiver of this transfer, may undo it
  const allowed = session?.user?.role === "head" || me === rec.fromMemberId || me === rec.toMemberId;
  if (!allowed) return;
  await prisma.settlementRecord.delete({ where: { id } });
  await logActivity("settlement", "deleted", `Undid a settlement (${formatINR(rec.amount)})`, rec.periodId);
  revalidatePath("/", "layout");
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
  const me = session?.user?.memberId;
  const allowed = session?.user?.role === "head" || me === adv.fromMemberId || me === adv.toMemberId;
  if (!allowed) return;
  const payback = formData.get("leg") === "payback";
  await prisma.advance.update({ where: { id }, data: payback ? { paybackSettled: true, paybackSettledAt: new Date() } : { settled: true, settledAt: new Date() } });
  await logActivity("settlement", "created", `Marked an advance ${payback ? "repaid" : "paid"} (${formatINR(adv.amount)})`, adv.periodId);
  revalidatePath("/", "layout");
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
  const me = session?.user?.memberId;
  const allowed = session?.user?.role === "head" || me === adv.fromMemberId || me === adv.toMemberId;
  if (!allowed) return;
  if (formData.get("delete") === "1") await prisma.advance.delete({ where: { id } });
  else if (formData.get("leg") === "payback") await prisma.advance.update({ where: { id }, data: { paybackSettled: false, paybackSettledAt: null } });
  else await prisma.advance.update({ where: { id }, data: { settled: false, settledAt: null } });
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
}

export async function closeLoan(formData: FormData) {
  if (!(await isHead())) return;
  const loanId = Number(formData.get("loanId"));
  if (!loanId) return;
  const loan = await prisma.loan.update({ where: { id: loanId }, data: { status: "closed" } });
  await logActivity("loan", "updated", `Closed “${loan.name}”`);
  revalidatePath("/", "layout");
}

export async function deleteLoan(formData: FormData) {
  if (!(await isHead())) return;
  const loanId = Number(formData.get("loanId"));
  if (!loanId) return;
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  await prisma.loan.delete({ where: { id: loanId } });
  if (loan) await logActivity("loan", "deleted", `Deleted “${loan.name}”`);
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
    revalidatePath("/", "layout");
    return { ok: false, error: `"${name}" is already taken — saved everything except the name.`, n };
  }

  // Setup edits define the recurring TEMPLATE only — the current open month is left
  // untouched. The change takes effect from next month (clonePeriodInto regenerates
  // each Setup category's tagged Sheet line + budget from the template).
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
    revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  await tx.budget.deleteMany({ where: { periodId } });
  await tx.expenseEntry.deleteMany({ where: { periodId, OR: [{ oneOff: false }, { note: CARRY_NOTE }] } });
  await tx.incomeEntry.deleteMany({ where: { periodId, OR: [{ oneOff: false }, { note: SURPLUS_NOTE }] } });
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
  return { ok: true, message: "Preview rebuilt from your latest setup." };
}

// Toggle whether an income / expense line repeats into next month (the oneOff flag).
export async function toggleIncomeRepeat(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("id"));
  const row = await prisma.incomeEntry.findUnique({ where: { id } });
  if (!row) return;
  await prisma.incomeEntry.update({ where: { id }, data: { oneOff: !row.oneOff } });
  revalidatePath("/", "layout");
}

export async function toggleExpenseRepeat(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("id"));
  const row = await prisma.expenseEntry.findUnique({ where: { id } });
  if (!row) return;
  await prisma.expenseEntry.update({ where: { id }, data: { oneOff: !row.oneOff } });
  revalidatePath("/", "layout");
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
  const categoryId = formData.get("categoryId") ? Number(formData.get("categoryId")) : null;
  const memberId = formData.get("memberId") ? Number(formData.get("memberId")) : null;
  if (!householdId || !name || !amount || amount <= 0) return;
  if (kind === "expense" && !categoryId) return;
  const sched = await scheduleFromForm(householdId, formData);
  if (sched.installmentsTotal && sched.intervalMonths === 1) name = stripInstNumber(name);
  const max = await prisma.recurringItem.aggregate({ where: { householdId }, _max: { sortOrder: true } });
  await prisma.recurringItem.create({
    data: { householdId, kind, name, amount, categoryId: kind === "expense" ? categoryId : null, memberId, sortOrder: (max._max.sortOrder ?? 0) + 1, ...sched },
  });
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
    revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
  return { ok: true, n };
}

export async function deleteRecurringItem(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("id"));
  await prisma.recurringItem.deleteMany({ where: { id } });
  revalidatePath("/", "layout");
}

export async function toggleRecurringActive(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("id"));
  const item = await prisma.recurringItem.findUnique({ where: { id } });
  if (!item) return;
  await prisma.recurringItem.update({ where: { id }, data: { active: !item.active } });
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
}
