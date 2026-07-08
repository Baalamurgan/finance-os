"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth, signOut } from "@/auth";
import { isUnlocked } from "@/lib/applock";
import { formatINR, parseAmount } from "@/lib/format";
import { generateMonth } from "@/lib/periodClone";
import { isMiscBucket, MISC_SUBCATEGORIES } from "@/lib/misc";
import { planBillMonth, type FundingStyle } from "@/lib/schedule";

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

// May this caller edit entries in this period right now?
// Head can edit any month (incl. closed); Manager only while the month is open.
async function canEditNow(periodId: number) {
  if (await isHead()) return true;
  return await periodOpen(periodId);
}

// Success signal for useActionState-driven modals (close + reset only on real success).
export type SaveState = { ok: boolean; n: number };

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

// Create (no id) or update (id present). Head/Manager; head may edit closed months.
// Returns true on success. Note (label) is REQUIRED.
async function doSaveExpense(formData: FormData): Promise<boolean> {
  if (!(await canEdit())) return false;

  const id = formData.get("id") ? Number(formData.get("id")) : null;
  const periodId = Number(formData.get("periodId"));
  let categoryId = Number(formData.get("categoryId")) || 0;
  const amount = parseAmount(formData.get("amount"));
  const label = String(formData.get("label") ?? "").trim();
  const memberRaw = formData.get("memberId");
  const memberId = memberRaw ? Number(memberRaw) : null;
  const necessaryRaw = formData.get("necessary"); // "default" | "yes" | "no"

  if (!periodId || !amount || !label) return false; // note required
  if (!(await canEditNow(periodId))) return false;

  // create-a-new-category-on-the-fly (e.g. "YouTube" under Monthly) when none is picked
  const newCatName = String(formData.get("newCategoryName") ?? "").trim();
  if (!categoryId && newCatName) {
    const period = await prisma.period.findUnique({ where: { id: periodId } });
    if (!period) return false;
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
  if (!categoryId) return false;

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  const necessary =
    necessaryRaw === "yes" ? true : necessaryRaw === "no" ? false : (category?.necessary ?? true);
  // auto-attribute to the category's responsible member when none is picked
  const finalMemberId = memberId ?? category?.responsibleMemberId ?? null;

  if (id) {
    await prisma.expenseEntry.update({
      where: { id },
      data: { categoryId, amount, label, memberId: finalMemberId, necessary },
    });
    await logActivity("expense", "updated", `Edited expense “${label}” to ${formatINR(amount)}`, periodId);
  } else {
    // Guard: a new expense can't exceed the month's current balance (income − expense).
    const [inc, exp] = await Promise.all([
      prisma.incomeEntry.aggregate({ where: { periodId }, _sum: { amount: true } }),
      prisma.expenseEntry.aggregate({ where: { periodId }, _sum: { amount: true } }),
    ]);
    const bal = (inc._sum.amount ?? 0) - (exp._sum.amount ?? 0);
    if (amount > bal) return false; // blocked (UI also guards)
    // "Repeat every month" (checkbox) → also add to the recurring template so it's
    // generated every month; unchecked → one-off (this month only)
    const oneOff = formData.get("repeat") !== "on";
    await prisma.expenseEntry.create({
      data: { periodId, categoryId, amount, label, memberId: finalMemberId, necessary, oneOff },
    });
    if (!oneOff) await promoteToTemplate(periodId, "expense", label, amount, categoryId, finalMemberId);
    await logActivity("expense", "created", `Added expense “${label}” ${formatINR(amount)}`, periodId);
  }
  revalidatePath("/", "layout");
  return true;
}

export async function saveExpense(formData: FormData) {
  await doSaveExpense(formData);
}
export async function saveExpenseAction(prev: SaveState, formData: FormData): Promise<SaveState> {
  const ok = await doSaveExpense(formData);
  return { ok, n: ok ? prev.n + 1 : prev.n };
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
  await prisma.incomeEntry.update({ where: { id }, data: { source, amount, ownerId } });
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

// Log an actual spend in a tracked category (Expenses tab).
// ANY signed-in member can log — auto-attributed to themselves (like the WhatsApp groups).
async function doAddSpend(formData: FormData): Promise<boolean> {
  const session = await auth();
  const selfId = session?.user?.memberId;
  if (!selfId) return false; // must be a mapped member
  if (!(await unlocked())) return false; // app-lock

  const periodId = Number(formData.get("periodId"));
  const categoryId = Number(formData.get("categoryId"));
  const amount = parseAmount(formData.get("amount"));
  const label = String(formData.get("label") ?? "").trim();

  if (!periodId || !categoryId || !amount || !label) return false;
  if (!(await periodOpen(periodId))) return false;

  // Misc (Personal/Misc) spends must carry a reporting sub-category (Food, Travel…);
  // other categories already are a category, so it stays null there.
  const subCategoryRaw = String(formData.get("subCategory") ?? "").trim();
  const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { section: true, tracked: true } });
  const misc = cat ? isMiscBucket(cat) : false;
  if (misc && !subCategoryRaw) return false; // mandatory for misc
  const subCategory = misc && subCategoryRaw ? subCategoryRaw : null;

  // Only the head may log a spend on behalf of another member; everyone else = self.
  const overrideId = Number(formData.get("memberId")) || 0;
  const memberId = overrideId && session?.user?.role === "head" ? overrideId : selfId;

  const imagePath = await saveUpload(formData.get("image"));
  await prisma.spend.create({
    data: { periodId, categoryId, memberId, label, amount, subCategory, imagePath },
  });
  await logActivity("spend", "created", `Logged spend “${label}” ${formatINR(amount)}`, periodId);
  revalidatePath("/", "layout");
  return true;
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
  if (!(await unlocked())) return; // app-lock
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
  if (!(await unlocked())) return; // app-lock
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
  if (!(await unlocked())) return prev; // app-lock
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

// Head adds money into the general Piggy (e.g. a manual top-up). Positive entry.
export async function depositPiggy(formData: FormData) {
  if (!(await isHead())) return;
  const amount = parseAmount(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim() || "Manual top-up";
  // target = "general" (general Piggy) or a sinking-fund categoryId
  const target = String(formData.get("target") ?? "general");
  if (!amount || amount <= 0) return;
  const household = await prisma.household.findFirst();
  if (!household) return;
  const sinkingCatId = target !== "general" ? Number(target) : null;
  await prisma.piggyEntry.create({
    data: {
      householdId: household.id,
      categoryId: sinkingCatId,
      kind: sinkingCatId ? "sinking" : "piggy",
      amount: Math.abs(amount),
      note: `Deposit: ${note}`,
    },
  });
  await logActivity("piggy", "created", `Added ${formatINR(amount)} to Piggy — ${note}`);
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

const CATEGORY_SECTIONS = ["Loans", "Chits", "Monthly", "Yearly", "Misc"] as const;

// The billing shape of a category from the Setup form. `billingMode` chooses one of three
// mutually-exclusive treatments; every field not relevant to the chosen mode is cleared, so
// switching modes never leaves stale sinking/lump config behind.
type BillingFields = {
  monthlyBudget: number | null; sinking: boolean; cycleMonths: number | null; fixed: boolean; tracked: boolean;
  billEveryMonths: number | null; billMonth: number | null; billDay: number | null; billAmount: number | null;
};
function parseBillingFields(formData: FormData): { ok: true; fields: BillingFields } | { ok: false; error: string } {
  const blank: BillingFields = { monthlyBudget: null, sinking: false, cycleMonths: null, fixed: false, tracked: false, billEveryMonths: null, billMonth: null, billDay: null, billAmount: null };
  const mode = String(formData.get("billingMode") ?? "monthly");
  const round = (x: number) => Math.round(x * 100) / 100;
  if (mode === "lump") {
    const every = Number(formData.get("billEveryMonths")) || 12;
    if (![2, 3, 4, 6, 12].includes(every)) return { ok: false, error: "Pick a valid frequency." };
    const amt = parseAmount(formData.get("billAmount"));
    if (!amt || amt <= 0) return { ok: false, error: "A full bill needs an amount." };
    const day = Number(formData.get("billDay"));
    return { ok: true, fields: { ...blank, billEveryMonths: every, billMonth: Math.min(12, Math.max(1, Number(formData.get("billMonth")) || 1)), billDay: day >= 1 && day <= 31 ? day : null, billAmount: round(amt) } };
  }
  if (mode === "sinking") {
    const share = parseAmount(formData.get("monthlyBudget"));
    const cycle = Number(formData.get("cycleMonths"));
    if (!share || share <= 0 || !cycle || cycle < 1) return { ok: false, error: "Sinking funds need a monthly amount and a cycle." };
    return { ok: true, fields: { ...blank, sinking: true, tracked: true, monthlyBudget: round(share), cycleMonths: cycle } };
  }
  const fixed = formData.get("fixed") === "on";
  const raw = String(formData.get("monthlyBudget") ?? "").trim();
  const amt = raw === "" ? null : parseAmount(raw);
  if (fixed && (!amt || amt <= 0)) return { ok: false, error: "A fixed bill needs a monthly amount." };
  return { ok: true, fields: { ...blank, fixed, tracked: !fixed, monthlyBudget: amt != null ? round(amt) : null } };
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
  const sectionRaw = String(formData.get("section") ?? "").trim();
  const section = (CATEGORY_SECTIONS as readonly string[]).includes(sectionRaw) ? sectionRaw : "Monthly";

  try {
    await prisma.category.create({
      data: { householdId, name, section, responsibleMemberId, ...billing.fields },
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
  if (!(await unlocked())) return; // app-lock
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
  if (!(await unlocked())) return; // app-lock
  const me = session?.user?.memberId;
  // head, OR the payer/receiver of this transfer, may undo it
  const allowed = session?.user?.role === "head" || me === rec.fromMemberId || me === rec.toMemberId;
  if (!allowed) return;
  await prisma.settlementRecord.delete({ where: { id } });
  await logActivity("settlement", "deleted", `Undid a settlement (${formatINR(rec.amount)})`, rec.periodId);
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
      data: { name, section, responsibleMemberId, ...billing.fields },
    });
  } catch {
    // unique-name clash → keep the old name, still apply the rest
    await prisma.category.update({
      where: { id },
      data: { section, responsibleMemberId, ...billing.fields },
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
async function clonePeriodStructure(
  tx: Tx,
  _sourceId: number,
  targetId: number,
  householdId: number
) {
  // months are now GENERATED from the RecurringItem template (not cloned from the
  // previous month); _sourceId is kept for the callers' signatures.
  await generateMonth(tx, targetId, householdId);
}

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

// Marks the auto-generated "Last month surplus" income line so it can be
// found/replaced (estimate on a draft → final at wind-down). oneOff so it never
// re-copies into the month after.
const SURPLUS_NOTE = "__surplus__";

// Add an ESTIMATED "last month surplus" income line to a draft, from the source
// (current open) month's live carry-out. Replaces any prior estimate.
async function addEstimatedSurplus(
  tx: Tx,
  source: { id: number; label: string; carryForward: number },
  targetId: number,
) {
  const [inc, exp] = await Promise.all([
    tx.incomeEntry.aggregate({ where: { periodId: source.id }, _sum: { amount: true } }),
    tx.expenseEntry.aggregate({ where: { periodId: source.id }, _sum: { amount: true } }),
  ]);
  const carryOut = source.carryForward + (inc._sum.amount ?? 0) - (exp._sum.amount ?? 0);
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

// Marks the auto-carried "over-budget excess + misc spends" one-off expense lines
// (estimate on a draft → final at wind-down), so they can be replaced not doubled.
const CARRY_NOTE = "__carry__";

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
  const spentOf = (c: number) => spends.filter((s) => s.categoryId === c).reduce((a, s) => a + s.amount, 0);

  const mon = source.label.split(" ")[0]; // "JUL 2026" → "JUL"
  await tx.expenseEntry.deleteMany({ where: { periodId: targetId, note: CARRY_NOTE } });
  for (const c of trackedCats) {
    const b = budgetOf(c.id);
    if (c.sinking && b > 0) continue; // sinking → its fund, never carried
    if (b > 0) {
      const rem = b - spentOf(c.id);
      if (rem >= 0) continue; // under budget → Piggy, not carried
      await tx.expenseEntry.create({
        data: { periodId: targetId, categoryId: c.id, label: `${c.name} over-budget (from ${source.label})`, amount: -rem, necessary: true, oneOff: true, note: CARRY_NOTE },
      });
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
  const current = await latestOpenPeriod(householdId);
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
  });
  revalidatePath("/", "layout");
  redirect(`/?y=${draft.year}&m=${draft.month}`);
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
  if (kind === "installment") {
    const total = formData.get("installmentsTotal") ? Number(formData.get("installmentsTotal")) : null;
    const current = Number(formData.get("installmentCurrent")) || 1;
    const inst = await installmentStartFrom(householdId, total, current);
    return { intervalMonths: 1, dueDay: null, ...inst };
  }
  if (kind === "periodic") {
    const interval = Math.min(60, Math.max(2, Number(formData.get("intervalMonths")) || 12));
    const y = Number(formData.get("periodicYear")) || new Date().getFullYear();
    const m = Math.min(12, Math.max(1, Number(formData.get("periodicMonth")) || 1));
    const total = formData.get("periodicCount") ? Math.max(1, Number(formData.get("periodicCount"))) : null;
    const dueDay = formData.get("dueDay") ? Math.min(31, Math.max(1, Number(formData.get("dueDay")))) : null;
    return { intervalMonths: interval, installmentsTotal: total, installmentStartYear: y, installmentStartMonth: m, dueDay };
  }
  return { intervalMonths: 1, installmentsTotal: null, installmentStartYear: null, installmentStartMonth: null, dueDay: null };
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

  const period = await prisma.period.findUnique({ where: { id: periodId } });
  if (!period || period.status !== "open") return;
  const householdId = period.householdId;

  const [incomes, expenses, budgets, spends, trackedCats, billFundCats, sinkFunds] = await Promise.all([
    prisma.incomeEntry.findMany({ where: { periodId } }),
    prisma.expenseEntry.findMany({ where: { periodId } }),
    prisma.budget.findMany({ where: { periodId } }),
    prisma.spend.findMany({ where: { periodId } }),
    prisma.category.findMany({ where: { householdId, tracked: true, onHold: false } }),
    prisma.category.findMany({ where: { householdId, onHold: false, NOT: { fundingStyle: null } } }),
    prisma.piggyEntry.groupBy({ by: ["categoryId"], where: { householdId, kind: "sinking" }, _sum: { amount: true } }),
  ]);
  const fundBalance = (catId: number) => sinkFunds.find((f) => f.categoryId === catId)?._sum.amount ?? 0;

  const income = incomes.reduce((s, i) => s + i.amount, 0);
  const expense = expenses.reduce((s, e) => s + e.amount, 0);
  const carryOut = period.carryForward + income - expense;

  const budgetOf = (catId: number) =>
    budgets.find((b) => b.categoryId === catId)?.planned ?? 0;
  const spentOf = (catId: number) =>
    spends.filter((s) => s.categoryId === catId).reduce((sum, s) => sum + s.amount, 0);

  let movedToPiggy = 0;
  // over-budget excess + misc spends are carried into NEXT month as one-off expenses
  const carryToNext: { categoryId: number; amount: number; label: string; memberId?: number | null }[] = [];

  const nextMonth = period.month === 12 ? 1 : period.month + 1;
  const nextYear = period.month === 12 ? period.year + 1 : period.year;
  const nextLabel = `${new Date(nextYear, nextMonth - 1, 1)
    .toLocaleString("en-US", { month: "short" })
    .toUpperCase()} ${nextYear}`;

  await prisma.$transaction(async (tx) => {
    for (const cat of trackedCats) {
      const budget = budgetOf(cat.id);
      const spent = spentOf(cat.id);
      if (cat.sinking && budget > 0) {
        // SINKING: always settle against its own fund. remainder = share − spent;
        // positive accrues, negative DRAWS from the fund (this month's share is
        // applied first, the fund covers the rest of the bill). Fund may go negative.
        await tx.piggyEntry.create({
          data: {
            householdId,
            periodId,
            categoryId: cat.id,
            kind: "sinking",
            amount: budget - spent,
            note: `${period.label} · ${cat.name}`,
          },
        });
      } else if (budget > 0) {
        const remainder = budget - spent;
        if (remainder >= 0) {
          // under budget → save the leftover to the general Piggy
          await tx.piggyEntry.create({
            data: {
              householdId,
              periodId,
              categoryId: cat.id,
              kind: "piggy",
              amount: remainder,
              note: `${period.label} · ${cat.name}`,
            },
          });
          movedToPiggy += remainder;
        } else {
          // over budget → carry the excess into next month as a one-off expense
          carryToNext.push({
            categoryId: cat.id,
            amount: -remainder,
            label: `${cat.name} over-budget (from ${period.label})`,
          });
        }
      } else if (spent > 0) {
        // tracked, no budget = Misc → carry EACH spend as its own line ("JUL · <spend>")
        const mon = period.label.split(" ")[0];
        for (const s of spends.filter((sp) => sp.categoryId === cat.id)) {
          carryToNext.push({
            categoryId: cat.id,
            amount: s.amount,
            label: `${mon} · ${s.label}`,
            memberId: s.memberId, // tag to the spender (display; excluded from settlement)
          });
        }
      }
    }

    // Goal-based "bill with a fund": the set-aside accrues into the fund; at the due month
    // the bill draws from it. Recomputed from the same inputs generateMonth used, so the
    // fund tracks exactly what the sheet showed.
    for (const cat of billFundCats) {
      if (cat.billAmount == null || cat.billAmount <= 0 || cat.billMonth == null || cat.billEveryMonths == null) continue;
      const plan = planBillMonth({
        billAmount: cat.billAmount,
        billMonth: cat.billMonth,
        everyMonths: cat.billEveryMonths,
        fund: fundBalance(cat.id),
        fundingStyle: cat.fundingStyle as FundingStyle,
        fixedShare: cat.monthlyBudget,
        month: period.month,
      });
      const delta = plan.kind === "save" ? plan.contribution : plan.kind === "bill" ? -plan.fromFund : 0;
      if (delta !== 0) {
        await tx.piggyEntry.create({
          data: { householdId, periodId, categoryId: cat.id, kind: "sinking", amount: delta, note: `${period.label} · ${cat.name}` },
        });
      }
    }

    await tx.period.update({
      where: { id: periodId },
      data: { status: "closed", closedAt: new Date(), movedToPiggy },
    });

    const next = await tx.period.upsert({
      where: { householdId_year_month: { householdId, year: nextYear, month: nextMonth } },
      create: { householdId, year: nextYear, month: nextMonth, label: nextLabel, carryForward: carryOut },
      // if next month already exists as a preview draft, promote it to a real open
      // month (keeping the head's edits — hasStructure below prevents re-cloning)
      update: { carryForward: carryOut, status: "open" },
    });

    // clone recurring structure into the next month if it's empty
    const hasStructure = await tx.expenseEntry.count({ where: { periodId: next.id } });
    if (hasStructure === 0) await clonePeriodStructure(tx, periodId, next.id, householdId);

    // add the carried over-budget + misc as one-off expenses on next month's sheet
    // (oneOff so they are NOT copied forward again into later months). Replace any
    // estimate a draft already carried (CARRY_NOTE) so they aren't doubled.
    await tx.expenseEntry.deleteMany({ where: { periodId: next.id, note: CARRY_NOTE } });
    for (const c of carryToNext) {
      await tx.expenseEntry.create({
        data: {
          periodId: next.id,
          categoryId: c.categoryId,
          label: c.label,
          amount: c.amount,
          memberId: c.memberId ?? null,
          necessary: true,
          oneOff: true,
          note: CARRY_NOTE,
        },
      });
    }

    // Surplus → next month's INCOME (replaces the "carried in" opening balance).
    // Replace any estimate a draft may already carry. A deficit stays a negative
    // carryForward (a carried-in shortfall), not a negative income line.
    await tx.incomeEntry.deleteMany({ where: { periodId: next.id, note: SURPLUS_NOTE } });
    if (carryOut > 0) {
      await tx.incomeEntry.create({
        data: {
          periodId: next.id,
          source: `Last month surplus (from ${period.label})`,
          amount: Math.round(carryOut * 100) / 100,
          oneOff: true,
          note: SURPLUS_NOTE,
        },
      });
      await tx.period.update({ where: { id: next.id }, data: { carryForward: 0 } });
    }
  });

  revalidatePath("/", "layout");
}
