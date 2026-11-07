"use server";

import { revalidatePath } from "next/cache";
import { resolveHoldingFromForm } from "@/lib/finance/networth";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { ACCOUNT_TYPES, TXN_TYPES, BALANCE_ACCOUNT_TYPES, type TxnType } from "@/lib/finance/types";

async function me() {
  const session = await auth();
  if (!session?.user) return null;
  const email = session.user.email?.toLowerCase();
  return session.user.memberId
    ? prisma.member.findUnique({ where: { id: session.user.memberId } })
    : email
      ? prisma.member.findFirst({ where: { email } })
      : null;
}

function rev() {
  revalidatePath("/personal", "layout");
}

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// Calendar month 1–12 (annual-fee month), or null when blank/out of range.
const clampMonth = (n: number | null) => (n == null ? null : n >= 1 && n <= 12 ? Math.round(n) : null);

// ── Accounts ─────────────────────────────────────────────────────────────────
export type AccountFormState = { ok: boolean; error?: string; n: number };

export async function addAccount(
  prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  if (!name) return { ok: false, error: "Name the card.", n };
  if (!ACCOUNT_TYPES.includes(type as (typeof ACCOUNT_TYPES)[number])) return { ok: false, error: "Pick a type.", n };
  const account = await prisma.financeAccount.create({
    data: {
      memberId: member.id,
      type,
      name,
      institution: String(formData.get("institution") ?? "").trim() || null,
      network: String(formData.get("network") ?? "").trim() || null,
      last4: String(formData.get("last4") ?? "").trim().slice(0, 4) || null,
      color: String(formData.get("color") ?? "").trim() || "#6366f1",
      openingBalance: BALANCE_ACCOUNT_TYPES.has(type) ? (num(formData.get("openingBalance")) ?? 0) : 0,
    },
  });
  if (type === "credit_card") {
    await prisma.creditCardDetail.create({
      data: {
        accountId: account.id,
        creditLimit: num(formData.get("creditLimit")),
        statementDay: num(formData.get("statementDay")),
        dueOffsetDays: num(formData.get("dueOffsetDays")),
        annualFee: num(formData.get("annualFee")),
        annualFeeMonth: clampMonth(num(formData.get("annualFeeMonth"))),
      },
    });
  }
  rev();
  return { ok: true, n };
}

export async function updateAccount(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const account = await prisma.financeAccount.findFirst({ where: { id, memberId: member.id } });
  if (!account) return;
  await prisma.financeAccount.update({
    where: { id },
    data: {
      name: String(formData.get("name") ?? account.name).trim() || account.name,
      institution: String(formData.get("institution") ?? "").trim() || null,
      network: String(formData.get("network") ?? "").trim() || null,
      last4: String(formData.get("last4") ?? "").trim().slice(0, 4) || null,
      color: String(formData.get("color") ?? "").trim() || account.color,
      active: formData.get("active") == null ? account.active : formData.get("active") === "on",
      reimbursed: formData.get("reimbursed") === "on", // spends aren't family cash now → settle next month (Pluxee, credit-like)
      // Opening balance is editable for debit/prepaid (a correction to the starting point).
      ...(BALANCE_ACCOUNT_TYPES.has(account.type) && formData.get("openingBalance") != null
        ? { openingBalance: num(formData.get("openingBalance")) ?? account.openingBalance }
        : {}),
    },
  });
  rev();
}

// Mark (or unmark) a balance account as THE member's family account — the one that physically holds their
// family In-Hand (e.g. SBI). One per member: choosing it clears the flag on their other accounts. Family
// Cash/UPI spends then post to it, and the In-Hand card shows its balance beside the holding figure.
export async function setFamilyPrimary(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const on = formData.get("on") === "1";
  const account = await prisma.financeAccount.findFirst({ where: { id, memberId: member.id, active: true } });
  if (!account || !BALANCE_ACCOUNT_TYPES.has(account.type)) return;
  await prisma.$transaction([
    prisma.financeAccount.updateMany({ where: { memberId: member.id }, data: { familyPrimary: false } }),
    ...(on ? [prisma.financeAccount.update({ where: { id }, data: { familyPrimary: true } })] : []),
  ]);
  rev();
  revalidatePath("/", "layout"); // family In-Hand + Add-spend read it too
}

// Mark (or clear) the member's PERSONAL money account — the personal app's "In account now" is its balance.
// At most one per member.
export async function setPersonalPrimary(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const on = formData.get("on") === "1";
  const account = await prisma.financeAccount.findFirst({ where: { id, memberId: member.id, active: true } });
  if (!account || !BALANCE_ACCOUNT_TYPES.has(account.type)) return;
  await prisma.$transaction([
    prisma.financeAccount.updateMany({ where: { memberId: member.id }, data: { personalPrimary: false } }),
    ...(on ? [prisma.financeAccount.update({ where: { id }, data: { personalPrimary: true } })] : []),
  ]);
  rev();
}

// Load money onto a debit/prepaid card — a "topup" ledger line that raises its balance.
export async function topUpCard(formData: FormData) {
  const member = await me();
  if (!member) return;
  const accountId = Number(formData.get("accountId"));
  const account = await prisma.financeAccount.findFirst({ where: { id: accountId, memberId: member.id } });
  if (!account || !BALANCE_ACCOUNT_TYPES.has(account.type)) return;
  const amount = num(formData.get("amount"));
  if (!amount || amount <= 0) return;
  const rawDate = String(formData.get("date") ?? "");
  const date = rawDate ? new Date(rawDate) : new Date();
  await prisma.accountTransaction.create({
    data: {
      memberId: member.id,
      accountId,
      date: isNaN(date.getTime()) ? new Date() : date,
      merchant: String(formData.get("note") ?? "").trim().slice(0, 120) || "Top-up",
      amount: Math.round(amount * 100) / 100,
      type: "topup",
      source: "manual",
    },
  });
  rev();
}

// Move money between two of your own balance accounts (bank/debit/prepaid) — the Money Plan's core
// "transfer" move. Records two ledger legs (out of `from`, into `to`) atomically so both balances
// update and the pair reads as one transfer. Credit cards can't be a leg (they're a credit line).
export type TransferState = { ok: boolean; error?: string; n: number };

export async function transferBetweenAccounts(prev: TransferState, formData: FormData): Promise<TransferState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const fromId = Number(formData.get("fromId"));
  const toId = Number(formData.get("toId"));
  const amount = num(formData.get("amount"));
  if (!fromId || !toId) return { ok: false, error: "Pick both accounts.", n };
  if (fromId === toId) return { ok: false, error: "Pick two different accounts.", n };
  if (!amount || amount <= 0) return { ok: false, error: "Enter an amount.", n };
  const [from, to] = await Promise.all([
    prisma.financeAccount.findFirst({ where: { id: fromId, memberId: member.id } }),
    prisma.financeAccount.findFirst({ where: { id: toId, memberId: member.id } }),
  ]);
  if (!from || !to || !BALANCE_ACCOUNT_TYPES.has(from.type) || !BALANCE_ACCOUNT_TYPES.has(to.type)) {
    return { ok: false, error: "Both must be bank / debit / prepaid accounts.", n };
  }
  const rawDate = String(formData.get("date") ?? "");
  const d = rawDate ? new Date(rawDate) : new Date();
  const date = isNaN(d.getTime()) ? new Date() : d;
  const amt = Math.round(amount * 100) / 100;
  const note = String(formData.get("note") ?? "").trim().slice(0, 120);
  await prisma.$transaction([
    prisma.accountTransaction.create({
      data: { memberId: member.id, accountId: fromId, date, merchant: note || `Transfer → ${to.name}`, amount: amt, type: "transfer_out", source: "manual" },
    }),
    prisma.accountTransaction.create({
      data: { memberId: member.id, accountId: toId, date, merchant: note || `Transfer ← ${from.name}`, amount: amt, type: "transfer_in", source: "manual" },
    }),
  ]);
  rev();
  return { ok: true, n };
}

// ── Recurring money-plan items (the maintainable template behind the Money Plan) ────────────────
export type PlanItemState = { ok: boolean; error?: string; n: number };

// Validate + normalise the shared fields of a plan item. Returns either an error or the clean data.
async function readPlanItem(memberId: number, formData: FormData) {
  const kind = String(formData.get("kind") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const amount = num(formData.get("amount"));
  const fromId = formData.get("fromAccountId") ? Number(formData.get("fromAccountId")) : null;
  const toId = formData.get("toAccountId") ? Number(formData.get("toAccountId")) : null;
  const dayRaw = num(formData.get("dayOfMonth"));
  const dayOfMonth = dayRaw == null ? null : Math.min(28, Math.max(1, Math.round(dayRaw)));
  if (kind !== "transfer" && kind !== "save") return { error: "Pick a type." as string };
  // A saving can name the net-worth holding each tick adds to (the member's own asset).
  const holdingId = kind === "save" ? await resolveHoldingFromForm(memberId, formData, label) : null;
  if (!label) return { error: "Name the move." };
  if (!amount || amount <= 0) return { error: "Enter an amount." };
  if (kind === "transfer") {
    if (!fromId || !toId) return { error: "Pick both accounts." };
    if (fromId === toId) return { error: "Pick two different accounts." };
  }
  const ids = [fromId, toId].filter((x): x is number => x != null);
  if (ids.length) {
    const accts = await prisma.financeAccount.findMany({ where: { id: { in: ids }, memberId } });
    if (accts.length !== new Set(ids).size) return { error: "Account not found." };
    if (accts.some((a) => !BALANCE_ACCOUNT_TYPES.has(a.type))) return { error: "Accounts must be bank / debit / prepaid." };
  }
  return {
    data: {
      kind,
      label: label.slice(0, 80),
      amount: Math.round(amount * 100) / 100,
      dayOfMonth,
      fromAccountId: fromId,
      toAccountId: kind === "transfer" ? toId : null,
      note: String(formData.get("note") ?? "").trim().slice(0, 120) || null,
      holdingId,
    },
  };
}

export async function addPlanItem(prev: PlanItemState, formData: FormData): Promise<PlanItemState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const r = await readPlanItem(member.id, formData);
  if (r.error) return { ok: false, error: r.error, n };
  await prisma.personalPlanItem.create({ data: { memberId: member.id, ...r.data! } });
  rev();
  return { ok: true, n };
}

export async function updatePlanItem(prev: PlanItemState, formData: FormData): Promise<PlanItemState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const id = Number(formData.get("id"));
  const existing = await prisma.personalPlanItem.findFirst({ where: { id, memberId: member.id } });
  if (!existing) return { ok: false, error: "Not found.", n };
  const r = await readPlanItem(member.id, formData);
  if (r.error) return { ok: false, error: r.error, n };
  // Setup only: from next month on. This month's step is its own (use "Apply to this month" to copy it there).
  await prisma.personalPlanItem.update({ where: { id }, data: r.data! });
  rev();
  return { ok: true, n };
}

// "Apply to this month" for a recurring transfer/saving: copy its CURRENT Setup values onto the month's step
// (creating the step if the month has none). Refused once the step is done — untick it first.
export async function applyPlanItemToMonth(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const member = await me();
  if (!member) return { ok: false, error: "Signed out." };
  const id = Number(formData.get("id"));
  const periodId = Number(formData.get("periodId"));
  const item = await prisma.personalPlanItem.findFirst({ where: { id, memberId: member.id } });
  const period = await prisma.personalPeriod.findFirst({ where: { id: periodId, memberId: member.id }, select: { id: true, status: true } });
  if (!item || !period) return { ok: false, error: "Not found." };
  if (period.status === "closed") return { ok: false, error: "That month is closed." };
  const data = { kind: item.kind, label: item.label, amount: item.amount, dayOfMonth: item.dayOfMonth, fromAccountId: item.fromAccountId, toAccountId: item.toAccountId, note: item.note, holdingId: item.holdingId };
  const step = await prisma.personalPlanStep.findFirst({ where: { periodId, templateKind: "planitem", templateId: id } });
  if (step?.status === "done") return { ok: false, error: "Already done this month — untick it in the plan first." };
  if (step) await prisma.personalPlanStep.update({ where: { id: step.id }, data: { ...data, status: "pending" } });
  else await prisma.personalPlanStep.create({ data: { memberId: member.id, periodId, ...data, templateKind: "planitem", templateId: id } });
  rev();
  return { ok: true };
}

export async function deletePlanItem(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const item = await prisma.personalPlanItem.findFirst({ where: { id, memberId: member.id } });
  if (!item) return;
  await prisma.personalPlanItem.delete({ where: { id } });
  rev();
}

// "Do it" for a recurring move: perform the move now (transfer legs, or a savings-pot deposit) so the
// balances/pot update. Same ledger writes as an ad-hoc transfer / savings deposit — this month's plan
// then reads it back as done.
export async function runPlanItem(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const item = await prisma.personalPlanItem.findFirst({ where: { id, memberId: member.id } });
  if (!item) return;
  const amt = Math.round(item.amount * 100) / 100;
  const date = new Date();
  if (item.kind === "transfer") {
    if (!item.fromAccountId || !item.toAccountId) return;
    const [from, to] = await Promise.all([
      prisma.financeAccount.findFirst({ where: { id: item.fromAccountId, memberId: member.id } }),
      prisma.financeAccount.findFirst({ where: { id: item.toAccountId, memberId: member.id } }),
    ]);
    if (!from || !to) return;
    await prisma.$transaction([
      prisma.accountTransaction.create({ data: { memberId: member.id, accountId: from.id, date, merchant: item.label || `Transfer → ${to.name}`, amount: amt, type: "transfer_out", source: "manual" } }),
      prisma.accountTransaction.create({ data: { memberId: member.id, accountId: to.id, date, merchant: item.label || `Transfer ← ${from.name}`, amount: amt, type: "transfer_in", source: "manual" } }),
    ]);
  } else if (item.kind === "save") {
    await prisma.personalSavings.create({ data: { memberId: member.id, amount: amt, note: item.label || "Recurring saving" } });
  }
  rev();
}

// Credit-card config (limit + billing cycle). Upserts the 1:1 detail row.
export async function setCreditConfig(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const account = await prisma.financeAccount.findFirst({ where: { id, memberId: member.id } });
  if (!account || account.type !== "credit_card") return;
  const clampDay = (n: number | null) => (n == null ? null : Math.min(28, Math.max(1, Math.round(n))));
  const clampReminder = (n: number | null) => (n == null ? null : Math.min(30, Math.max(0, Math.round(n))));
  const data = {
    creditLimit: num(formData.get("creditLimit")),
    statementDay: clampDay(num(formData.get("statementDay"))),
    dueOffsetDays: num(formData.get("dueOffsetDays")),
    reminderDays: clampReminder(num(formData.get("reminderDays"))),
    annualFee: num(formData.get("annualFee")),
    annualFeeMonth: clampMonth(num(formData.get("annualFeeMonth"))),
  };
  await prisma.creditCardDetail.upsert({
    where: { accountId: id },
    create: { accountId: id, ...data },
    update: data,
  });
  rev();
}

export async function deleteAccount(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const account = await prisma.financeAccount.findFirst({ where: { id, memberId: member.id } });
  if (!account) return;
  await prisma.financeAccount.delete({ where: { id } }); // cascades detail + txns
  rev();
}

// ── Transactions ───────────────────────────────────────────────────────────────
export async function addManualTransaction(formData: FormData) {
  const member = await me();
  if (!member) return;
  const accountId = Number(formData.get("accountId"));
  const account = await prisma.financeAccount.findFirst({ where: { id: accountId, memberId: member.id } });
  if (!account) return;
  const amount = num(formData.get("amount"));
  const merchant = String(formData.get("merchant") ?? "").trim();
  const type = String(formData.get("type") ?? "spend");
  const date = new Date(String(formData.get("date") ?? ""));
  if (!amount || amount <= 0 || !merchant || isNaN(date.getTime())) return;
  await prisma.accountTransaction.create({
    data: {
      memberId: member.id,
      accountId,
      date,
      merchant: merchant.slice(0, 120),
      amount: Math.round(amount * 100) / 100,
      type: TXN_TYPES.includes(type as TxnType) ? type : "spend",
      rewardPoints: num(formData.get("rewardPoints")),
      source: "manual",
    },
  });
  rev();
}

// Log the ₹ value of reward points redeemed as cash (used anywhere). It counts as the card's cashback,
// so it feeds the card's net profit/loss (cashback − fees). Optionally record how many points were burned.
export async function addPointsRedemption(formData: FormData) {
  const member = await me();
  if (!member) return;
  const accountId = Number(formData.get("accountId"));
  const account = await prisma.financeAccount.findFirst({ where: { id: accountId, memberId: member.id }, select: { id: true, type: true } });
  if (!account || account.type !== "credit_card") return;
  const amount = num(formData.get("amount"));
  if (!amount || amount <= 0) return;
  await prisma.accountTransaction.create({
    data: {
      memberId: member.id,
      accountId,
      date: new Date(),
      merchant: "Points redeemed → cash",
      amount: Math.round(amount * 100) / 100,
      type: "cashback", // realised reward → counts toward the card's profit/loss
      rewardPoints: num(formData.get("rewardPoints")),
      source: "manual",
    },
  });
  rev();
}

export async function deleteTransaction(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const t = await prisma.accountTransaction.findUnique({ where: { id } });
  if (!t || t.memberId !== member.id) return;
  // Mirror lines are owned by their source spend — edit/remove them there (Family spends / Expenses tab),
  // so the card balance stays in sync. Manual ledger lines (no link) delete normally.
  if (t.familySpendId != null || t.personalSpendId != null) return;
  await prisma.accountTransaction.delete({ where: { id } });
  rev();
}

// ── Net-worth holdings ─────────────────────────────────────────────────────────
export type ItemFormState = { ok: boolean; error?: string; n: number };

// Optional holding details (FD/RD booking date, tenure, rate) read from the add/edit form.
function holdingDetails(formData: FormData) {
  const startRaw = String(formData.get("startDate") ?? "").trim();
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(startRaw) ? new Date(`${startRaw}T00:00:00`) : null;
  const tenure = num(formData.get("tenureMonths"));
  const years = num(formData.get("tenureYears"));
  const months = tenure ?? (years != null ? years * 12 : null);
  const rate = num(formData.get("interestRate"));
  return {
    startDate,
    tenureMonths: months != null && months > 0 ? Math.round(months) : null,
    interestRate: rate != null && rate >= 0 && rate < 100 ? Math.round(rate * 100) / 100 : null,
  };
}

export async function addNetWorthItem(prev: ItemFormState, formData: FormData): Promise<ItemFormState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const category = String(formData.get("category") ?? "");
  const type = String(formData.get("type") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const value = num(formData.get("value"));
  if (category !== "asset" && category !== "liability") return { ok: false, error: "Pick asset or liability.", n };
  if (!type || !name) return { ok: false, error: "Name it and pick a type.", n };
  if (value == null || value < 0) return { ok: false, error: "Enter a valid amount.", n };
  // What you've put in so far (defaults to today's value). Recorded as the holding's opening history entry.
  const investedRaw = num(formData.get("invested"));
  const invested = category === "asset" ? (investedRaw != null && investedRaw >= 0 ? investedRaw : value) : 0;
  const d = holdingDetails(formData);
  const r = (x: number) => Math.round(x * 100) / 100;
  await prisma.$transaction(async (tx) => {
    const item = await tx.netWorthItem.create({
      data: {
        memberId: member.id, category, type, name: name.slice(0, 120), value: r(value),
        quantity: num(formData.get("quantity")),
        institution: String(formData.get("institution") ?? "").trim() || null,
        notes: String(formData.get("notes") ?? "").trim() || null,
        ...d,
        valueAsOf: category === "asset" && Math.abs(value - invested) > 0.005 ? new Date() : null,
      },
    });
    if (category === "asset" && invested > 0) {
      await tx.netWorthEntry.create({ data: { memberId: member.id, itemId: item.id, date: d.startDate ?? new Date(), kind: "opening", amount: r(invested), note: "Invested before tracking" } });
    }
    if (category === "asset" && Math.abs(value - invested) > 0.005) {
      await tx.netWorthEntry.create({ data: { memberId: member.id, itemId: item.id, date: new Date(), kind: "value", amount: r(value), note: "Value when added" } });
    }
  });
  rev();
  return { ok: true, n };
}

// Edit a holding's details (name, institution, notes, units, FD terms). The value moves only through
// "Update value" / money in-out, so every change to it is in the history.
export async function updateNetWorthItem(prev: ItemFormState, formData: FormData): Promise<ItemFormState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const id = Number(formData.get("id"));
  const item = await prisma.netWorthItem.findFirst({ where: { id, memberId: member.id } });
  if (!item) return { ok: false, error: "Not found.", n };
  const value = num(formData.get("value"));
  const d = holdingDetails(formData);
  await prisma.netWorthItem.update({
    where: { id },
    data: {
      name: String(formData.get("name") ?? item.name).trim() || item.name,
      // a liability's balance is edited directly (no history for loans)
      ...(item.category === "liability" && value != null && value >= 0 ? { value: Math.round(value * 100) / 100 } : {}),
      quantity: num(formData.get("quantity")),
      institution: String(formData.get("institution") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
      ...d,
    },
  });
  rev();
  return { ok: true, n };
}

// Set a holding's CURRENT value (checked Groww / the bank). Recorded in its history with the date.
export async function setHoldingValue(prev: ItemFormState, formData: FormData): Promise<ItemFormState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const id = Number(formData.get("id"));
  const value = num(formData.get("value"));
  const item = await prisma.netWorthItem.findFirst({ where: { id, memberId: member.id, category: "asset" } });
  if (!item) return { ok: false, error: "Not found.", n };
  if (value == null || value < 0) return { ok: false, error: "Enter the value.", n };
  const v = Math.round(value * 100) / 100;
  const now = new Date();
  await prisma.$transaction([
    prisma.netWorthEntry.create({ data: { memberId: member.id, itemId: id, date: now, kind: "value", amount: v, note: String(formData.get("note") ?? "").trim() || null } }),
    prisma.netWorthItem.update({ where: { id }, data: { value: v, valueAsOf: now } }),
  ]);
  rev();
  return { ok: true, n };
}

// Money in / out of a holding by hand (a lump-sum top-up, a partial redemption) — dated history entry; the
// value moves by the same amount.
export async function addHoldingMoney(prev: ItemFormState, formData: FormData): Promise<ItemFormState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const id = Number(formData.get("id"));
  const kind = String(formData.get("kind")) === "withdrawal" ? "withdrawal" : "contribution";
  const amount = num(formData.get("amount"));
  const dateRaw = String(formData.get("date") ?? "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? new Date(`${dateRaw}T12:00:00`) : new Date();
  const item = await prisma.netWorthItem.findFirst({ where: { id, memberId: member.id, category: "asset" } });
  if (!item) return { ok: false, error: "Not found.", n };
  if (!amount || amount <= 0) return { ok: false, error: "Enter an amount.", n };
  const a = Math.round(amount * 100) / 100;
  if (kind === "withdrawal" && a > item.value + 0.005) return { ok: false, error: "More than it's worth right now.", n };
  await prisma.$transaction([
    prisma.netWorthEntry.create({ data: { memberId: member.id, itemId: id, date, kind, amount: a, note: String(formData.get("note") ?? "").trim() || null } }),
    prisma.netWorthItem.update({ where: { id }, data: { value: kind === "withdrawal" ? { decrement: a } : { increment: a } } }),
  ]);
  rev();
  return { ok: true, n };
}

// Remove a history entry you added by hand (a Money Plan / Spends one is undone by unticking it there).
// Money in/out reverses its effect on the value; a value entry just leaves the history (value stays).
export async function deleteHoldingEntry(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const e = await prisma.netWorthEntry.findFirst({ where: { id, memberId: member.id } });
  if (!e || e.planStepId != null || e.spendId != null) return;
  await prisma.$transaction(async (tx) => {
    if (e.kind === "contribution" || e.kind === "opening") await tx.netWorthItem.update({ where: { id: e.itemId }, data: { value: { decrement: e.amount } } });
    else if (e.kind === "withdrawal") await tx.netWorthItem.update({ where: { id: e.itemId }, data: { value: { increment: e.amount } } });
    await tx.netWorthEntry.delete({ where: { id } });
  });
  rev();
}

export async function deleteNetWorthItem(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const item = await prisma.netWorthItem.findFirst({ where: { id, memberId: member.id } });
  if (!item) return;
  await prisma.netWorthItem.delete({ where: { id } });
  rev();
}
