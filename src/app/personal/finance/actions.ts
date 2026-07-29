"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { ACCOUNT_TYPES, TXN_TYPES, type TxnType } from "@/lib/finance/types";

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
    },
  });
  if (type === "credit_card") {
    await prisma.creditCardDetail.create({
      data: {
        accountId: account.id,
        creditLimit: num(formData.get("creditLimit")),
        statementDay: num(formData.get("statementDay")),
        dueOffsetDays: num(formData.get("dueOffsetDays")),
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
    },
  });
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

export async function deleteTransaction(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const t = await prisma.accountTransaction.findUnique({ where: { id } });
  if (!t || t.memberId !== member.id) return;
  await prisma.accountTransaction.delete({ where: { id } });
  rev();
}

// ── Net-worth holdings ─────────────────────────────────────────────────────────
export type ItemFormState = { ok: boolean; error?: string; n: number };

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
  await prisma.netWorthItem.create({
    data: {
      memberId: member.id,
      category,
      type,
      name: name.slice(0, 120),
      value: Math.round(value * 100) / 100,
      quantity: num(formData.get("quantity")),
      institution: String(formData.get("institution") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });
  rev();
  return { ok: true, n };
}

export async function updateNetWorthItem(prev: ItemFormState, formData: FormData): Promise<ItemFormState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const id = Number(formData.get("id"));
  const item = await prisma.netWorthItem.findFirst({ where: { id, memberId: member.id } });
  if (!item) return { ok: false, error: "Not found.", n };
  const value = num(formData.get("value"));
  await prisma.netWorthItem.update({
    where: { id },
    data: {
      name: String(formData.get("name") ?? item.name).trim() || item.name,
      value: value != null && value >= 0 ? Math.round(value * 100) / 100 : item.value,
      quantity: num(formData.get("quantity")),
      institution: String(formData.get("institution") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });
  rev();
  return { ok: true, n };
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
