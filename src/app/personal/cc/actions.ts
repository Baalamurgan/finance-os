"use server";

import { revalidatePath } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

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

// ── Cards ────────────────────────────────────────────────────────────────────
export async function addPersonalCard(formData: FormData) {
  const member = await me();
  if (!member) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await prisma.personalCard.create({
    data: {
      memberId: member.id,
      name,
      bank: String(formData.get("bank") ?? "").trim() || null,
      last4: String(formData.get("last4") ?? "").trim() || null,
      limitAmt: Number(formData.get("limitAmt")) || null,
      color: String(formData.get("color") ?? "").trim() || "#6366f1",
    },
  });
  rev();
}

export async function deletePersonalCard(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const card = await prisma.personalCard.findUnique({ where: { id } });
  if (!card || card.memberId !== member.id) return;
  await prisma.personalCard.delete({ where: { id } }); // cascades txns
  rev();
}

// ── Statement import (PDF → Claude → structured transactions) ─────────────────
export type ExtractedTxn = { date: string; merchant: string; amount: number; type: "spend" | "payment" | "refund" };
export type ExtractResult =
  | { ok: true; transactions: ExtractedTxn[] }
  | { ok: false; error: string };

const EXTRACT_PROMPT = `This is a credit-card statement. Extract EVERY transaction line into the record_transactions tool.
For each transaction give:
- date: the transaction date as YYYY-MM-DD (infer the year from the statement period).
- merchant: the merchant / description, cleaned up (drop reference numbers and location codes if noisy).
- amount: the rupee amount as a positive number (no ₹ sign, no commas).
- type: "spend" for purchases and charges (incl. fees/interest), "payment" for bill payments or credits to the card, "refund" for reversals/cashback.
Skip summary rows, opening/closing balances, and totals. Return the transactions in statement order.`;

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
          name: "record_transactions",
          description: "Record every transaction extracted from the statement.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              transactions: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    date: { type: "string", description: "YYYY-MM-DD" },
                    merchant: { type: "string" },
                    amount: { type: "number", description: "positive rupees" },
                    type: { type: "string", enum: ["spend", "payment", "refund"] },
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
      tool_choice: { type: "tool", name: "record_transactions" },
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
    if (!block || block.type !== "tool_use") return { ok: false, error: "Couldn't read any transactions from that PDF." };
    const raw = (block.input as { transactions?: ExtractedTxn[] }).transactions ?? [];
    const transactions = raw
      .filter((t) => t && t.merchant && Number.isFinite(t.amount) && t.amount > 0)
      .map((t) => ({
        date: t.date,
        merchant: String(t.merchant).slice(0, 120),
        amount: Math.round(t.amount * 100) / 100,
        type: (["spend", "payment", "refund"].includes(t.type) ? t.type : "spend") as ExtractedTxn["type"],
      }));
    if (transactions.length === 0) return { ok: false, error: "No transactions found — is this a card statement PDF?" };
    return { ok: true, transactions };
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `AI import failed (${e.status}).` : "AI import failed — please try again.";
    return { ok: false, error: msg };
  }
}

// Save a reviewed batch (from the import review table).
export async function savePersonalCardTxns(formData: FormData): Promise<{ ok: boolean; error?: string; n?: number }> {
  const member = await me();
  if (!member) return { ok: false, error: "Signed out." };
  const cardId = Number(formData.get("cardId"));
  const card = await prisma.personalCard.findUnique({ where: { id: cardId } });
  if (!card || card.memberId !== member.id) return { ok: false, error: "Pick a card." };
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
      cardId,
      date: new Date(r.date),
      merchant: String(r.merchant).slice(0, 120),
      amount: Math.round(r.amount * 100) / 100,
      type: (["spend", "payment", "refund"].includes(r.type) ? r.type : "spend"),
    }))
    .filter((r) => !isNaN(r.date.getTime()));
  if (data.length === 0) return { ok: false, error: "Nothing to save." };
  await prisma.personalCardTxn.createMany({ data });
  rev();
  return { ok: true, n: data.length };
}

export async function deletePersonalCardTxn(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const t = await prisma.personalCardTxn.findUnique({ where: { id } });
  if (!t || t.memberId !== member.id) return;
  await prisma.personalCardTxn.delete({ where: { id } });
  rev();
}
