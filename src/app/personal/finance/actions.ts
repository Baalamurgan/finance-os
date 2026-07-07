"use server";

import { revalidatePath } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
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
  const data = {
    creditLimit: num(formData.get("creditLimit")),
    statementDay: clampDay(num(formData.get("statementDay"))),
    dueOffsetDays: num(formData.get("dueOffsetDays")),
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

// ── Statement import (PDF → Claude → metadata + transactions → review) ──────────
export type ExtractedTxn = {
  date: string;
  merchant: string;
  amount: number;
  type: TxnType;
  rewardPoints?: number | null;
  confidence?: number | null;
};
export type StatementMeta = {
  statementDate?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  dueDate?: string | null;
  creditLimit?: number | null;
  totalSpends?: number | null;
  totalPayments?: number | null;
  cashbackEarned?: number | null;
  pointsEarned?: number | null;
};
export type ExtractResult =
  | { ok: true; transactions: ExtractedTxn[]; meta: StatementMeta }
  | { ok: false; error: string };

const EXTRACT_PROMPT = `This is a credit-card statement. Use the record_statement tool.
1. Fill "meta" with the statement's own summary values (dates as YYYY-MM-DD, amounts as positive numbers, no ₹/commas): statementDate, billing period start/end, payment dueDate, creditLimit, totalSpends, totalPayments, cashbackEarned, pointsEarned. Leave a field null if the statement doesn't show it.
2. Fill "transactions" with EVERY line item. For each: date (YYYY-MM-DD, infer year from the period), merchant (cleaned — drop reference/location codes), amount (positive), type (one of: spend, payment, refund, cashback, reward, fee, interest, charge, adjustment), rewardPoints (points earned/redeemed on that line, or null), and confidence (0-1: how sure you are of that row; lower it when the layout is ambiguous).
Skip opening/closing balance and total rows. Keep statement order.`;

export async function extractStatement(formData: FormData): Promise<ExtractResult> {
  const member = await me();
  if (!member) return { ok: false, error: "Signed out." };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "AI import isn't configured yet — an ANTHROPIC_API_KEY is needed on the server." };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a PDF statement." };
  if (file.type && file.type !== "application/pdf") return { ok: false, error: "Please upload a PDF." };
  if (file.size > 25 * 1024 * 1024) return { ok: false, error: "PDF is too large (max 25 MB)." };

  const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const client = new Anthropic();
  try {
    const resp = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      tools: [
        {
          name: "record_statement",
          description: "Record the statement summary and every transaction line.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              meta: {
                type: "object",
                additionalProperties: false,
                properties: {
                  statementDate: { type: ["string", "null"] },
                  periodStart: { type: ["string", "null"] },
                  periodEnd: { type: ["string", "null"] },
                  dueDate: { type: ["string", "null"] },
                  creditLimit: { type: ["number", "null"] },
                  totalSpends: { type: ["number", "null"] },
                  totalPayments: { type: ["number", "null"] },
                  cashbackEarned: { type: ["number", "null"] },
                  pointsEarned: { type: ["number", "null"] },
                },
                required: [],
              },
              transactions: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    date: { type: "string", description: "YYYY-MM-DD" },
                    merchant: { type: "string" },
                    amount: { type: "number", description: "positive rupees" },
                    type: { type: "string", enum: TXN_TYPES as unknown as string[] },
                    rewardPoints: { type: ["number", "null"] },
                    confidence: { type: ["number", "null"], description: "0-1" },
                  },
                  required: ["date", "merchant", "amount", "type"],
                },
              },
            },
            required: ["transactions"],
          },
          strict: true,
        },
      ],
      tool_choice: { type: "tool", name: "record_statement" },
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
            { type: "text", text: EXTRACT_PROMPT },
          ],
        },
      ],
    });

    const block = resp.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return { ok: false, error: "Couldn't read the statement." };
    const input = block.input as { meta?: StatementMeta; transactions?: ExtractedTxn[] };
    const transactions = (input.transactions ?? [])
      .filter((t) => t && t.merchant && Number.isFinite(t.amount) && t.amount > 0)
      .map((t) => ({
        date: t.date,
        merchant: String(t.merchant).slice(0, 120),
        amount: Math.round(t.amount * 100) / 100,
        type: (TXN_TYPES.includes(t.type) ? t.type : "spend") as TxnType,
        rewardPoints: Number.isFinite(t.rewardPoints as number) ? (t.rewardPoints as number) : null,
        confidence: Number.isFinite(t.confidence as number) ? (t.confidence as number) : null,
      }));
    if (transactions.length === 0) return { ok: false, error: "No transactions found — is this a card statement PDF?" };
    return { ok: true, transactions, meta: input.meta ?? {} };
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `AI import failed (${e.status}).` : "AI import failed — please try again.";
    return { ok: false, error: msg };
  }
}

// Save a reviewed batch from the import review table.
export async function saveImportedTransactions(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; n?: number }> {
  const member = await me();
  if (!member) return { ok: false, error: "Signed out." };
  const accountId = Number(formData.get("accountId"));
  const account = await prisma.financeAccount.findFirst({ where: { id: accountId, memberId: member.id } });
  if (!account) return { ok: false, error: "Pick a card." };
  let rows: ExtractedTxn[] = [];
  try {
    rows = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { ok: false, error: "Bad data." };
  }
  const data = rows
    .filter((r) => r && r.merchant && Number.isFinite(r.amount) && r.amount > 0 && r.date)
    .map((r) => ({
      memberId: member.id,
      accountId,
      date: new Date(r.date),
      merchant: String(r.merchant).slice(0, 120),
      amount: Math.round(r.amount * 100) / 100,
      type: (TXN_TYPES.includes(r.type) ? r.type : "spend") as string,
      rewardPoints: Number.isFinite(r.rewardPoints as number) ? (r.rewardPoints as number) : null,
      confidence: Number.isFinite(r.confidence as number) ? (r.confidence as number) : null,
      needsReview: (r.confidence ?? 1) < 0.6,
      source: "import",
    }))
    .filter((r) => !isNaN(r.date.getTime()));
  if (data.length === 0) return { ok: false, error: "Nothing to save." };
  await prisma.accountTransaction.createMany({ data });
  rev();
  return { ok: true, n: data.length };
}
