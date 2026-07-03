"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { auth, signOut } from "@/auth";

export async function doSignOut() {
  await signOut({ redirectTo: "/signin" });
}

// Authorization comes from the Auth.js session role now.
async function isHead() {
  const session = await auth();
  return session?.user?.role === "head";
}

// Head + Manager may add/edit/delete income & expenses. Members are read-only
// (they can still log their own spends via addSpend).
async function canEdit() {
  const session = await auth();
  return session?.user?.role === "head" || session?.user?.role === "manager";
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

// Create (no id) or update (id present). Head/Manager; head may edit closed months.
// Returns true on success. Note (label) is REQUIRED.
async function doSaveExpense(formData: FormData): Promise<boolean> {
  if (!(await canEdit())) return false;

  const id = formData.get("id") ? Number(formData.get("id")) : null;
  const periodId = Number(formData.get("periodId"));
  let categoryId = Number(formData.get("categoryId")) || 0;
  const amount = Number(formData.get("amount"));
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
  } else {
    // Guard: a new expense can't exceed the month's current balance (income − expense).
    const [inc, exp] = await Promise.all([
      prisma.incomeEntry.aggregate({ where: { periodId }, _sum: { amount: true } }),
      prisma.expenseEntry.aggregate({ where: { periodId }, _sum: { amount: true } }),
    ]);
    const bal = (inc._sum.amount ?? 0) - (exp._sum.amount ?? 0);
    if (amount > bal) return false; // blocked (UI also guards)
    // "Repeat every month" (checkbox) → recurring (copies forward); unchecked → one-off (this month only)
    const oneOff = formData.get("repeat") !== "on";
    await prisma.expenseEntry.create({
      data: { periodId, categoryId, amount, label, memberId: finalMemberId, necessary, oneOff },
    });
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
  const amount = Number(formData.get("amount"));
  const ownerRaw = formData.get("ownerId");
  const ownerId = ownerRaw ? Number(ownerRaw) : null;

  if (!periodId || !source || !amount) return false;
  if (!(await canEditNow(periodId))) return false;

  // "Repeat every month" → recurring; unchecked → one-time (not copied forward)
  const oneOff = formData.get("repeat") !== "on";
  await prisma.incomeEntry.create({ data: { periodId, source, amount, ownerId, oneOff } });
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

export async function deleteExpense(formData: FormData) {
  if (!(await canEdit())) return;
  const id = Number(formData.get("id"));
  if (!id) return;
  const e = await prisma.expenseEntry.findUnique({ where: { id } });
  if (e && !(await canEditNow(e.periodId))) return;
  await prisma.expenseEntry.delete({ where: { id } });
  revalidatePath("/", "layout");
}

export async function deleteIncome(formData: FormData) {
  if (!(await canEdit())) return;
  const id = Number(formData.get("id"));
  if (!id) return;
  const i = await prisma.incomeEntry.findUnique({ where: { id } });
  if (i && !(await canEditNow(i.periodId))) return;
  await prisma.incomeEntry.delete({ where: { id } });
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

  const periodId = Number(formData.get("periodId"));
  const categoryId = Number(formData.get("categoryId"));
  const amount = Number(formData.get("amount"));
  const label = String(formData.get("label") ?? "").trim();

  if (!periodId || !categoryId || !amount || !label) return false;
  if (!(await periodOpen(periodId))) return false;

  // Only the head may log a spend on behalf of another member; everyone else = self.
  const overrideId = Number(formData.get("memberId")) || 0;
  const memberId = overrideId && session?.user?.role === "head" ? overrideId : selfId;

  const imagePath = await saveUpload(formData.get("image"));
  await prisma.spend.create({
    data: { periodId, categoryId, memberId, label, amount, imagePath },
  });
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
  const id = Number(formData.get("id"));
  if (!id) return;
  const spend = await prisma.spend.findUnique({ where: { id } });
  if (!spend) return;
  if (!(await periodOpen(spend.periodId))) return;

  const isOwner = spend.memberId === session.user.memberId;
  if (session.user.role !== "head" && !isOwner) return;

  // (Receipt files are deferred/cloud-stored — nothing to unlink locally.)
  await prisma.spend.delete({ where: { id } });
  revalidatePath("/", "layout");
}

// Use Piggy money: reduce a Piggy/sinking bucket and add the amount as a ONE-OFF
// income to the chosen month. No forced expense — the household then spends it
// from any category via the normal add-spend/add-expense flow (the added income
// raises the month balance, which the expense guard uses to permit those spends).
// oneOff:true so the piggy income never clones into future months.
export async function withdrawPiggy(formData: FormData) {
  if (!(await isHead())) return;
  const periodId = Number(formData.get("periodId"));
  const amount = Number(formData.get("amount"));
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
  revalidatePath("/", "layout");
}

// Head adds money into the general Piggy (e.g. a manual top-up). Positive entry.
export async function depositPiggy(formData: FormData) {
  if (!(await isHead())) return;
  const amount = Number(formData.get("amount"));
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
  revalidatePath("/", "layout");
}

// Head sets a fund's CURRENT balance to an exact amount — records the difference
// as an "Adjustment" entry so the history stays intact. target = general | catId.
export async function setFundBalance(formData: FormData) {
  if (!(await isHead())) return;
  const targetAmount = Number(formData.get("amount"));
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
  revalidatePath("/", "layout");
}

// Add a new recurring/tracked category (Setup screen).
export async function createCategory(formData: FormData) {
  if (!(await isHead())) return;
  const householdId = Number(formData.get("householdId"));
  const name = String(formData.get("name") ?? "").trim();
  if (!householdId || !name) return;
  const amountRaw = String(formData.get("monthlyBudget") ?? "").trim();
  const monthlyBudget = amountRaw === "" ? null : Number(amountRaw);
  const sinking = formData.get("sinking") === "on";
  const cycleRaw = String(formData.get("cycleMonths") ?? "").trim();
  const cycleMonths = sinking && cycleRaw ? Number(cycleRaw) : null;

  try {
    await prisma.category.create({
      data: {
        householdId,
        name,
        section: "Monthly",
        tracked: true,
        monthlyBudget,
        sinking,
        cycleMonths,
      },
    });
  } catch {
    // duplicate name — ignore
  }
  revalidatePath("/", "layout");
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
  const amount = Number(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!householdId || !periodId || !fromMemberId || !toMemberId || !amount) return;
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
  revalidatePath("/", "layout");
}

// Undo a recorded settlement. Head-only.
export async function unsettle(formData: FormData) {
  const session = await auth();
  const id = Number(formData.get("id"));
  if (!id) return;
  const rec = await prisma.settlementRecord.findUnique({ where: { id } });
  if (!rec) return;
  const me = session?.user?.memberId;
  // head, OR the payer/receiver of this transfer, may undo it
  const allowed = session?.user?.role === "head" || me === rec.fromMemberId || me === rec.toMemberId;
  if (!allowed) return;
  await prisma.settlementRecord.delete({ where: { id } });
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
  if (!householdId || !name) return;
  await prisma.loan.create({
    data: { householdId, name, kind, outstanding, monthlyAmount, memberId, totalInstallments, paidInstallments },
  });
  revalidatePath("/", "layout");
}

// Record a monthly payment / prepayment. principalPart reduces the outstanding;
// for chits it bumps the installment count. Auto-closes when done.
export async function recordLoanPayment(formData: FormData) {
  if (!(await isHead())) return;
  const loanId = Number(formData.get("loanId"));
  const periodId = formData.get("periodId") ? Number(formData.get("periodId")) : null;
  const amount = Number(formData.get("amount")) || 0;
  const principalPart = Number(formData.get("principalPart")) || 0;
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
    prisma.loanPayment.create({ data: { loanId, periodId, amount, principalPart, note } }),
    prisma.loan.update({
      where: { id: loanId },
      data: { outstanding: newOutstanding, paidInstallments: newPaid, status: done ? "closed" : loan.status },
    }),
  ]);
  revalidatePath("/", "layout");
}

export async function closeLoan(formData: FormData) {
  if (!(await isHead())) return;
  const loanId = Number(formData.get("loanId"));
  if (!loanId) return;
  await prisma.loan.update({ where: { id: loanId }, data: { status: "closed" } });
  revalidatePath("/", "layout");
}

export async function deleteLoan(formData: FormData) {
  if (!(await isHead())) return;
  const loanId = Number(formData.get("loanId"));
  if (!loanId) return;
  await prisma.loan.delete({ where: { id: loanId } });
  revalidatePath("/", "layout");
}

// Head edits a category's recurring defaults on the Monthly Setup screen.
export async function saveRecurring(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("categoryId"));
  if (!id) return;
  const amountRaw = String(formData.get("monthlyBudget") ?? "").trim();
  const monthlyBudget = amountRaw === "" ? null : Number(amountRaw);
  const sinking = formData.get("sinking") === "on";
  const cycleRaw = String(formData.get("cycleMonths") ?? "").trim();
  const cycleMonths = sinking && cycleRaw ? Number(cycleRaw) : null;
  // sinking funds require a monthly amount AND a valid cycle
  if (sinking && (!monthlyBudget || monthlyBudget <= 0 || !cycleMonths || cycleMonths < 1)) return;
  // responsible/default member: tags this category's lines + receives over-budget excess
  const respRaw = String(formData.get("responsibleMemberId") ?? "").trim();
  const responsibleMemberId = respRaw === "" ? null : Number(respRaw);

  const cat = await prisma.category.findUnique({ where: { id } });
  if (!cat) return;

  await prisma.category.update({
    where: { id },
    data: { monthlyBudget, sinking, cycleMonths, responsibleMemberId },
  });

  // Keep OPEN months consistent with the new recurring config:
  //  • upsert the period Budget to the new monthly amount (drives wind-down + Expenses tab)
  //  • for SINKING categories, the sheet shows the monthly SHARE — replace this category's
  //    sheet line(s) in the open month with a single "{name} (monthly share)" = monthlyBudget
  const openPeriods = await prisma.period.findMany({
    where: { householdId: cat.householdId, status: "open" },
    select: { id: true },
  });
  for (const p of openPeriods) {
    if (monthlyBudget != null && monthlyBudget > 0) {
      const existing = await prisma.budget.findFirst({ where: { periodId: p.id, categoryId: id } });
      if (existing) await prisma.budget.update({ where: { id: existing.id }, data: { planned: monthlyBudget } });
      else await prisma.budget.create({ data: { periodId: p.id, categoryId: id, planned: monthlyBudget } });
    }
    if (sinking && monthlyBudget != null && monthlyBudget > 0) {
      await prisma.$transaction([
        prisma.expenseEntry.deleteMany({ where: { periodId: p.id, categoryId: id } }),
        prisma.expenseEntry.create({
          data: {
            periodId: p.id,
            categoryId: id,
            label: `${cat.name} (monthly share)`,
            amount: monthlyBudget,
            necessary: cat.necessary,
          },
        }),
      ]);
    }
  }
  revalidatePath("/", "layout");
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

// Seed a new period's budgets from the recurring template (Category.monthlyBudget).
// On-hold categories are skipped.
async function seedBudgets(tx: Tx, householdId: number, periodId: number) {
  const cats = await tx.category.findMany({
    where: { householdId, monthlyBudget: { not: null }, onHold: false },
  });
  for (const c of cats) {
    await tx.budget.create({
      data: { periodId, categoryId: c.id, planned: c.monthlyBudget! },
    });
  }
}

// Clone last month's recurring structure (income + expense allocations) into a new period,
// and seed budgets from the template. Actual spends start empty.
async function clonePeriodStructure(
  tx: Tx,
  sourceId: number,
  targetId: number,
  householdId: number
) {
  const [incomes, expenses, heldCats] = await Promise.all([
    tx.incomeEntry.findMany({ where: { periodId: sourceId, oneOff: false } }),
    // oneOff lines (carried misc / over-budget) must NOT propagate to future months
    tx.expenseEntry.findMany({ where: { periodId: sourceId, oneOff: false } }),
    tx.category.findMany({ where: { householdId, onHold: true }, select: { id: true } }),
  ]);
  const held = new Set(heldCats.map((c) => c.id));
  for (const i of incomes) {
    // skip carried-over one-off adjustments (e.g. Misc/Piggy lines) so they don't repeat
    if (i.amount < 0) continue;
    await tx.incomeEntry.create({
      data: { periodId: targetId, source: i.source, amount: i.amount, ownerId: i.ownerId },
    });
  }
  for (const e of expenses) {
    if (held.has(e.categoryId)) continue;
    await tx.expenseEntry.create({
      data: {
        periodId: targetId,
        label: e.label,
        amount: e.amount,
        categoryId: e.categoryId,
        memberId: e.memberId,
        necessary: e.necessary,
      },
    });
  }
  await seedBudgets(tx, householdId, targetId);
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
  const latest = await prisma.period.findFirst({
    where: { householdId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  await prisma.$transaction(async (tx) => {
    const p = await tx.period.create({ data: { householdId, year, month, label } });
    if (latest) await clonePeriodStructure(tx, latest.id, p.id, householdId);
    else await seedBudgets(tx, householdId, p.id);
  });
  revalidatePath("/", "layout");
}

// derive a short member code from a name (initials, else first letters)
function deriveCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

// Member management (head-only).
// Email is set only at creation (it's the login whitelist); edits change name/code/role only.
export async function saveMember(formData: FormData) {
  if (!(await isHead())) return;
  const id = formData.get("id") ? Number(formData.get("id")) : null;
  const householdId = Number(formData.get("householdId"));
  const name = String(formData.get("name") ?? "").trim();
  const codeRaw = String(formData.get("code") ?? "").trim();
  const role = String(formData.get("role") ?? "member");
  const code = (codeRaw || deriveCode(name)).toUpperCase();

  if (!name) return;

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
      if (!householdId || !email) return; // email mandatory when adding
      await prisma.member.create({
        data: { householdId, name, code, role, email, isEarner: true },
      });
    }
  } catch {
    // ignore unique-constraint collisions (duplicate email/code); UI re-renders unchanged
  }
  revalidatePath("/", "layout");
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

  const [incomes, expenses, budgets, spends, trackedCats] = await Promise.all([
    prisma.incomeEntry.findMany({ where: { periodId } }),
    prisma.expenseEntry.findMany({ where: { periodId } }),
    prisma.budget.findMany({ where: { periodId } }),
    prisma.spend.findMany({ where: { periodId } }),
    prisma.category.findMany({ where: { householdId, tracked: true, onHold: false } }),
  ]);

  const income = incomes.reduce((s, i) => s + i.amount, 0);
  const expense = expenses.reduce((s, e) => s + e.amount, 0);
  const carryOut = period.carryForward + income - expense;

  const budgetOf = (catId: number) =>
    budgets.find((b) => b.categoryId === catId)?.planned ?? 0;
  const spentOf = (catId: number) =>
    spends.filter((s) => s.categoryId === catId).reduce((sum, s) => sum + s.amount, 0);

  let movedToPiggy = 0;
  // over-budget excess + misc spends are carried into NEXT month as one-off expenses
  const carryToNext: { categoryId: number; amount: number; label: string }[] = [];

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
        // tracked, no budget = Misc → carry the spend into next month as an expense
        carryToNext.push({
          categoryId: cat.id,
          amount: spent,
          label: `Misc (from ${period.label})`,
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
      update: { carryForward: carryOut },
    });

    // clone recurring structure into the next month if it's empty
    const hasStructure = await tx.expenseEntry.count({ where: { periodId: next.id } });
    if (hasStructure === 0) await clonePeriodStructure(tx, periodId, next.id, householdId);

    // add the carried over-budget + misc as one-off expenses on next month's sheet
    // (oneOff so they are NOT copied forward again into later months)
    for (const c of carryToNext) {
      await tx.expenseEntry.create({
        data: {
          periodId: next.id,
          categoryId: c.categoryId,
          label: c.label,
          amount: c.amount,
          necessary: true,
          oneOff: true,
        },
      });
    }
  });

  revalidatePath("/", "layout");
}
