"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { parseAmount } from "@/lib/format";
import { validateSpendLabel } from "@/lib/spendCategorize";
import { log } from "@/lib/log";
import { isPersonalUnlocked } from "@/lib/personal-lock";
import { ensurePersonalMonth, ensurePersonalPreview, rebuildPersonalPreview, seedPersonalCategories } from "@/lib/personal";
import { getCardBillReminders } from "@/lib/personal/cash";
import { currentCycle } from "@/lib/finance/cycle";

// The "high alert" CC dues for the signed-in member: bills due within 3 days (or overdue).
// Used by the after-unlock popup in BOTH family and personal views (a member's own cards).
// Deliberately amount-free — full detail lives behind the personal PIN.
export type CardHighAlert = { cardName: string; dueISO: string; daysUntilDue: number; overdue: boolean };
export async function getMyCardHighAlerts(): Promise<CardHighAlert[]> {
  const member = await meRead();
  if (!member) return [];
  // getCardBillReminders already windows each card by its own reminderDays (default 5),
  // so the popup fires exactly per the card's configured lead time.
  const reminders = await getCardBillReminders(member.id);
  return reminders.map((r) => ({ cardName: r.cardName, dueISO: r.dueISO, daysUntilDue: r.daysUntilDue, overdue: r.overdue }));
}

// The bell's reminder inbox: every active card reminder (within its lead window or overdue),
// with a link to pay. An item disappears here once its bill is marked paid — nothing to store.
export type CardReminderItem = { cardId: number; cardName: string; color: string; dueISO: string; daysUntilDue: number; overdue: boolean; amount: number };
export async function getMyCardReminders(): Promise<CardReminderItem[]> {
  const member = await meRead();
  if (!member) return [];
  const reminders = await getCardBillReminders(member.id);
  return reminders.map((r) => ({
    cardId: r.cardId,
    cardName: r.cardName,
    color: r.color,
    dueISO: r.dueISO,
    daysUntilDue: r.daysUntilDue,
    overdue: r.overdue,
    amount: r.taggedTotal || r.ledgerOutstanding || 0,
  }));
}

// The bell + top-bar reminder for repay-by dates on OPEN lending/borrowing. An item surfaces once
// today is within its `notifyDaysBefore` lead (or it's overdue) and clears the moment it's settled or
// deleted — nothing stored. Both directions: "you owe" (borrowed) and "collect" (lent). Peer-card
// debts carry a card; manual loans may carry a user-set date.
export type LendingReminder = {
  id: number;
  direction: "lent" | "borrowed";
  counterparty: string;
  amount: number; // outstanding
  dueISO: string;
  daysUntilDue: number; // negative = overdue
  overdue: boolean;
  note: string | null;
  cardName: string | null;
  color: string | null;
};
export async function getMyLendingReminders(): Promise<LendingReminder[]> {
  const member = await meRead();
  if (!member) return [];
  const loans = await prisma.personalLoan.findMany({
    where: { memberId: member.id, status: "open", dueDate: { not: null } },
    select: {
      id: true, direction: true, counterparty: true, outstanding: true, dueDate: true, note: true,
      notifyDaysBefore: true, cardAccount: { select: { name: true, color: true } },
    },
    orderBy: { dueDate: "asc" },
  });
  const DAY = 86400000;
  const today = new Date(); const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return loans
    .map((l) => {
      const due = l.dueDate!;
      const d0 = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
      const daysUntilDue = Math.round((d0 - t0) / DAY);
      return { loan: l, due, daysUntilDue };
    })
    // within the lead window (or overdue), per each loan's own notify setting
    .filter(({ loan, daysUntilDue }) => daysUntilDue <= loan.notifyDaysBefore)
    .map(({ loan, due, daysUntilDue }) => ({
      id: loan.id,
      direction: loan.direction === "borrowed" ? ("borrowed" as const) : ("lent" as const),
      counterparty: loan.counterparty,
      amount: loan.outstanding,
      dueISO: due.toISOString(),
      daysUntilDue,
      overdue: daysUntilDue < 0,
      note: loan.note,
      cardName: loan.cardAccount?.name ?? null,
      color: loan.cardAccount?.color ?? null,
    }));
}

// One-time heads-up for the person on the receiving end of a household-linked lend/borrow they didn't
// initiate:
//   • "card"  — the card OWNER, when someone paid with their card (peer-card spend),
//   • "split" — the person who now OWES, when someone split a spend / logged a reimbursement with them,
//   • "loan"  — either side of a manual "Record lending / borrowing" the other member created.
// The rule is simply "notify the member who didn't create the linked pair" (initiatedById ≠ me). Legacy
// rows (initiatedById null, pre-migration) fall back to the spend-payer heuristic. Card loans carry the
// card; split/reimburse loans carry a spend; manual loans carry neither. Returns the open ones so the
// popup can show each once (the client remembers which); the row clears once it's settled/deleted.
export type PeerCardUse = { id: number; kind: "card" | "split" | "loan"; direction: "lent" | "borrowed"; spender: string; note: string | null; amount: number; cardName: string | null; atISO: string };
export async function getMyIncomingPeerCardUses(): Promise<PeerCardUse[]> {
  const member = await meRead();
  if (!member) return [];
  const loans = await prisma.personalLoan.findMany({
    where: {
      memberId: member.id, status: "open", linkGroup: { not: null },
      OR: [
        { initiatedById: { not: member.id } }, // I didn't create this pair — new rows, any type
        { initiatedById: null, spendId: { not: null }, spend: { memberId: { not: member.id } } }, // legacy spend-linked
      ],
    },
    select: { id: true, direction: true, counterparty: true, note: true, amount: true, spendId: true, createdAt: true, cardAccount: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return loans.map((l) => ({
    id: l.id,
    kind: l.cardAccount ? "card" : l.spendId != null ? "split" : "loan",
    direction: l.direction === "borrowed" ? "borrowed" : "lent",
    spender: l.counterparty, note: l.note, amount: l.amount, cardName: l.cardAccount?.name ?? null, atISO: l.createdAt.toISOString(),
  }));
}

// Resolve the signed-in member WITHOUT touching the personal lock. Used by read-only actions
// that also run in Family view (where the personal-unlock cookie is intentionally absent).
async function meRead() {
  const session = await auth();
  if (!session?.user) return null;
  const email = session.user.email?.toLowerCase();
  return session.user.memberId
    ? prisma.member.findUnique({ where: { id: session.user.memberId } })
    : email
      ? prisma.member.findFirst({ where: { email } })
      : null;
}

// Resolve the member AND enforce the personal app-lock (mirrors loadPersonal): if the personal
// unlock has collapsed, log a `relock` line and bounce to /personal/lock instead of a silent
// no-op. Every mutating action uses this, so none can silently fail on a collapsed lock.
async function me(tag = "personal") {
  const member = await meRead();
  if (member && !(await isPersonalUnlocked(member.id))) {
    const ref = (await headers()).get("referer");
    let next: string | null = null;
    try { if (ref) { const u = new URL(ref); next = u.pathname + u.search; } } catch {}
    log.warn(tag, "relock", { outcome: "blocked", reason: "personal-locked", memberId: member.id, next });
    redirect(next ? `/personal/lock?next=${encodeURIComponent(next)}` : "/personal/lock");
  }
  return member;
}

async function ownsPeriod(memberId: number, periodId: number) {
  const p = await prisma.personalPeriod.findUnique({ where: { id: periodId } });
  return p && p.memberId === memberId ? p : null;
}

function rev() {
  revalidatePath("/personal", "layout");
}

// Resolve an optional "cardAccountId" from a form to a credit card the member owns (else
// null = paid from cash). Guards against a bad/foreign id, and lets editing un-tag (→ null).
async function ccCardId(memberId: number, formData: FormData): Promise<number | null> {
  const raw = Number(formData.get("cardAccountId"));
  if (!raw) return null;
  const acc = await prisma.financeAccount.findUnique({ where: { id: raw }, select: { memberId: true, type: true } });
  return acc && acc.memberId === memberId && acc.type === "credit_card" ? raw : null;
}

// Resolve "cardAccountId" to ANY active card in the member's household — day-to-day spends can be
// paid with any card, INCLUDING another member's (peer usage: you spend, they front the cash). Own
// card → isPeer false. Peer card → isPeer true, carrying the owner + the credit cycle so a repay-by
// date can be derived. Returns null for cash/UPI or a foreign/inactive card outside the household.
type SpendCard = {
  id: number;
  type: string;
  ownerId: number;
  ownerName: string;
  isPeer: boolean;
  statementDay: number | null;
  dueOffsetDays: number | null;
};
async function resolveSpendCard(memberId: number, formData: FormData): Promise<SpendCard | null> {
  const raw = Number(formData.get("cardAccountId"));
  if (!raw) return null;
  const self = await prisma.member.findUnique({ where: { id: memberId }, select: { householdId: true } });
  const acc = await prisma.financeAccount.findUnique({
    where: { id: raw },
    select: {
      id: true, type: true, active: true, memberId: true,
      member: { select: { name: true, householdId: true } },
      credit: { select: { statementDay: true, dueOffsetDays: true } },
    },
  });
  if (!acc || !acc.active) return null;
  const isPeer = acc.memberId !== memberId;
  if (isPeer && acc.member.householdId !== self?.householdId) return null; // peer cards: same household only
  return {
    id: acc.id, type: acc.type, ownerId: acc.memberId, ownerName: acc.member.name, isPeer,
    statementDay: acc.credit?.statementDay ?? null,
    dueOffsetDays: acc.credit?.dueOffsetDays ?? null,
  };
}

// The immutable repay-by date for a spend on a peer CREDIT card = that card's cycle due date for the
// spend's date. Debit/prepaid peer cards have no cycle → null (the payer must enter one).
function peerRepayDate(card: SpendCard, when: Date): Date | null {
  if (card.type !== "credit_card" || card.statementDay == null) return null;
  return currentCycle(card.statementDay, when, card.dueOffsetDays).dueDate;
}

// Resolve the repay-by date + notify lead for a peer-card spend. Credit cards derive it from the cycle
// (immutable). Every other card (debit/prepaid, or a credit card with no statement day) REQUIRES the
// payer to pick a date — there's no cycle to infer one from.
function resolvePeerRepay(
  card: SpendCard, formData: FormData, when: Date,
): { dueDate: Date; notifyDaysBefore: number } | { error: string } {
  let dueDate = peerRepayDate(card, when);
  if (!dueDate) {
    const raw = String(formData.get("repayBy") ?? "").trim();
    const d = raw ? new Date(`${raw}T00:00:00`) : null;
    if (!d || Number.isNaN(d.getTime())) return { error: `Pick a repay-by date for ${card.ownerName}'s card.` };
    dueDate = d;
  }
  const nd = Number(formData.get("notifyDaysBefore"));
  const notifyDaysBefore = Number.isFinite(nd) && nd >= 0 ? Math.round(nd) : 3;
  return { dueDate, notifyDaysBefore };
}

// "Collect by" for a SPLIT / REIMBURSEMENT (you paid; others owe you). Paid on your own credit card →
// derive it from that card's cycle (matches the modal's disabled auto date). Cash/UPI or a debit/prepaid
// card → the payer must pick a date. notifyDaysBefore = how many days ahead the nudge starts (default 3).
function resolveCollectBy(
  card: SpendCard | null, formData: FormData, when: Date,
): { dueDate: Date; notifyDaysBefore: number } | { error: string } {
  const nd = Number(formData.get("notifyDaysBefore"));
  const notifyDaysBefore = Number.isFinite(nd) && nd >= 0 ? Math.round(nd) : 3;
  const auto = card ? peerRepayDate(card, when) : null; // own credit card → from its cycle
  if (auto) return { dueDate: auto, notifyDaysBefore };
  const raw = String(formData.get("collectBy") ?? "").trim();
  const d = raw ? new Date(`${raw}T00:00:00`) : null;
  if (!d || Number.isNaN(d.getTime())) return { error: "Pick a collect-by date for the split." };
  return { dueDate: d, notifyDaysBefore };
}

// Keep a card's LEDGER line in sync with a personal spend, so the spend shows as a line item under that
// card (and drives its balance for debit/prepaid, its outstanding for credit). This is a VIEW layer:
// the month's spendable, cash-in-hand and credit dues still run through the card TAG (getPersonalCash /
// getCardDues) unchanged — the ledger line is additive. Idempotent: upserts on the spend link, or removes
// the line if the spend moved to cash. Deleting the spend cascades the line away via the FK.
async function syncPersonalSpendLedger(
  tx: Prisma.TransactionClient,
  a: { spendId: number; card: SpendCard | null; amount: number; label: string; date: Date; categoryName: string | null; payerName: string },
) {
  if (a.card) {
    // The ledger line lives on the card OWNER (their money/limit is what moves). Peer usage → source
    // "peer" (getCardDues treats it as a reimbursed line, kept apart from the owner's own dues) and the
    // merchant is prefixed with who spent, so the owner can see it's not their own charge.
    const source = a.card.isPeer ? "peer" : "personal";
    const merchant = a.card.isPeer ? `${a.payerName}: ${a.label}` : a.label;
    await tx.accountTransaction.upsert({
      where: { personalSpendId: a.spendId },
      update: { amount: a.amount, merchant, accountId: a.card.id, memberId: a.card.ownerId, source },
      create: { memberId: a.card.ownerId, accountId: a.card.id, date: a.date, merchant, amount: a.amount, type: "spend", category: a.categoryName, source, personalSpendId: a.spendId },
    });
  } else {
    await tx.accountTransaction.deleteMany({ where: { personalSpendId: a.spendId } });
  }
}

// Create / refresh / remove the two-sided peer-card debt for a spend. Called after the spend row is
// written. Idempotent: it clears any prior peer pair for this spend, then (if the spend is on a peer
// card) writes a fresh borrower + lender pair sharing a linkGroup, so settling/deleting either clears
// both. The repay-by date is derived from the card cycle (credit) and is immutable in the UI.
async function syncPeerCardLoans(
  tx: Prisma.TransactionClient,
  a: { spendId: number; payerId: number; payerName: string; card: SpendCard | null; amount: number; note: string; dueDate: Date | null; notifyDaysBefore: number },
) {
  // Peer loans are the only spend-linked loans carrying a linkGroup — drop them before rewriting.
  await tx.personalLoan.deleteMany({ where: { spendId: a.spendId, linkGroup: { not: null } } });
  if (!a.card || !a.card.isPeer) return;
  const linkGroup = randomUUID();
  const common = { amount: a.amount, outstanding: a.amount, note: a.note, spendId: a.spendId, linkGroup, cardAccountId: a.card.id, dueDate: a.dueDate, notifyDaysBefore: a.notifyDaysBefore, initiatedById: a.payerId };
  await tx.personalLoan.createMany({
    data: [
      { memberId: a.payerId, direction: "borrowed", counterparty: a.card.ownerName, ...common },
      { memberId: a.card.ownerId, direction: "lent", counterparty: a.payerName, ...common },
    ],
  });
}

// Create the receivable(s) for a split or reimbursement. Always writes the LENDER row on the payer
// (counterparty = who owes; sharedPaid/sharedShare recorded so it posts back as income when received).
// If the counterparty is a household MEMBER, also writes the mirrored BORROWER row on them, sharing a
// linkGroup so it shows in their Lending tab, pings them once, and settles/deletes as one unit.
async function createSharedReceivable(
  tx: Prisma.TransactionClient,
  a: {
    payerId: number; payerName: string; spendId: number; note: string;
    counterpartyMemberId: number | null; counterpartyName: string;
    owedAmount: number; fullPaid: number; myShare: number;
    dueDate: Date | null; notifyDaysBefore: number;
  },
) {
  const linkGroup = a.counterpartyMemberId ? randomUUID() : null;
  await tx.personalLoan.create({
    data: {
      memberId: a.payerId, direction: "lent", counterparty: a.counterpartyName,
      amount: a.owedAmount, outstanding: a.owedAmount, note: a.note,
      sharedPaid: a.fullPaid, sharedShare: a.myShare, spendId: a.spendId,
      dueDate: a.dueDate, notifyDaysBefore: a.notifyDaysBefore, linkGroup, initiatedById: a.payerId,
    },
  });
  if (a.counterpartyMemberId && linkGroup) {
    await tx.personalLoan.create({
      data: {
        memberId: a.counterpartyMemberId, direction: "borrowed", counterparty: a.payerName,
        amount: a.owedAmount, outstanding: a.owedAmount, note: a.note, spendId: a.spendId,
        dueDate: a.dueDate, notifyDaysBefore: a.notifyDaysBefore, linkGroup, initiatedById: a.payerId,
      },
    });
  }
}

export type PersonalSaveState = { ok: boolean; error?: string; n: number };

// ── Onboarding ───────────────────────────────────────────────────────────────
export async function finishPersonalOnboarding(formData: FormData) {
  // Onboarding runs before the personal lock exists — resolve without enforcing it.
  const member = await meRead();
  if (!member) return;
  await seedPersonalCategories(member.id);
  const period = await ensurePersonalMonth(member.id);

  const income = parseAmount(formData.get("income")) || 0;
  await prisma.personalPeriod.update({ where: { id: period.id }, data: { income } });

  // fixed monthly expenses: recurLabel[] / recurCat[] / recurAmt[]
  const labels = formData.getAll("recurLabel").map((v) => String(v).trim());
  const catIds = formData.getAll("recurCat").map((v) => Number(v));
  const amts = formData.getAll("recurAmt").map((v) => Number(v));
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] && catIds[i] && amts[i] > 0) {
      await prisma.personalExpense.create({
        data: { memberId: member.id, periodId: period.id, label: labels[i], categoryId: catIds[i], amount: amts[i], recurring: true },
      });
    }
  }

  await prisma.member.update({ where: { id: member.id }, data: { personalOnboarded: true } });
  redirect("/personal/expenses");
}

// ── Income ───────────────────────────────────────────────────────────────────
export async function setPersonalIncome(formData: FormData) {
  const member = await me();
  if (!member) return;
  const periodId = Number(formData.get("periodId"));
  const income = parseAmount(formData.get("income")) || 0;
  if (!(await ownsPeriod(member.id, periodId))) return;
  await prisma.personalPeriod.update({ where: { id: periodId }, data: { income } });
  rev();
}

// Extra one-off income this month (a gift, a parent topping you up) — raises the
// spendable "personal expense".
export async function addPersonalIncome(formData: FormData) {
  const member = await me();
  if (!member) return;
  const periodId = Number(formData.get("periodId"));
  const source = String(formData.get("source") ?? "").trim();
  const amount = parseAmount(formData.get("amount"));
  if (!source || !amount || amount <= 0) return;
  if (!(await ownsPeriod(member.id, periodId))) return;
  await prisma.personalIncome.create({ data: { memberId: member.id, periodId, source, amount } });
  rev();
}

export async function deletePersonalIncome(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const i = await prisma.personalIncome.findUnique({ where: { id } });
  if (!i || i.memberId !== member.id) return;
  await prisma.personalIncome.delete({ where: { id } });
  rev();
}

// Classify a category into a 50/30/20 bucket (need | want | invest).
export async function setPersonalCategoryBucket(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const bucket = String(formData.get("bucket"));
  if (!["need", "want", "invest"].includes(bucket)) return;
  const c = await prisma.personalCategory.findUnique({ where: { id } });
  if (!c || c.memberId !== member.id) return;
  await prisma.personalCategory.update({ where: { id }, data: { bucket } });
  rev();
}

// ── Sheet fixed expenses (label + amount, no category) ───────────────────────
export async function addPersonalExpense(
  prev: PersonalSaveState,
  formData: FormData,
): Promise<PersonalSaveState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const periodId = Number(formData.get("periodId"));
  const label = String(formData.get("label") ?? "").trim();
  const categoryId = Number(formData.get("categoryId"));
  const amount = parseAmount(formData.get("amount"));
  const recurring = formData.get("recurring") === "on";
  if (!periodId || !label || !categoryId || !amount || amount <= 0)
    return { ok: false, error: "Enter a name, category and amount.", n };
  if (!(await ownsPeriod(member.id, periodId))) return { ok: false, error: "Not your month.", n };
  const cardAccountId = await ccCardId(member.id, formData);
  await prisma.personalExpense.create({
    data: { memberId: member.id, periodId, label, categoryId, amount, recurring, cardAccountId },
  });
  rev();
  return { ok: true, n };
}

export async function updatePersonalExpense(
  prev: PersonalSaveState,
  formData: FormData,
): Promise<PersonalSaveState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const id = Number(formData.get("id"));
  const label = String(formData.get("label") ?? "").trim();
  const categoryId = Number(formData.get("categoryId"));
  const amount = parseAmount(formData.get("amount"));
  const recurring = formData.get("recurring") === "on";
  const e = await prisma.personalExpense.findUnique({ where: { id } });
  if (!e || e.memberId !== member.id) return { ok: false, error: "Not found.", n };
  if (!label || !categoryId || !amount || amount <= 0)
    return { ok: false, error: "Enter a name, category and amount.", n };
  const cardAccountId = await ccCardId(member.id, formData);
  await prisma.personalExpense.update({ where: { id }, data: { label, categoryId, amount, recurring, cardAccountId } });
  rev();
  return { ok: true, n };
}

export async function deletePersonalExpense(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const e = await prisma.personalExpense.findUnique({ where: { id } });
  if (!e || e.memberId !== member.id) return;
  await prisma.personalExpense.delete({ where: { id } });
  rev();
}

// ── Spends (categorised, Expenses tab) ───────────────────────────────────────
export async function addPersonalSpend(
  prev: PersonalSaveState,
  formData: FormData,
): Promise<PersonalSaveState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const periodId = Number(formData.get("periodId"));
  const categoryId = Number(formData.get("categoryId"));
  const amount = parseAmount(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim();
  if (!periodId || !categoryId || !amount || amount <= 0 || !note)
    return { ok: false, error: "Enter a name, category and amount.", n };
  if (!(await ownsPeriod(member.id, periodId))) return { ok: false, error: "Not your month.", n };
  const cat = await prisma.personalCategory.findUnique({ where: { id: categoryId } });
  if (!cat || cat.memberId !== member.id) return { ok: false, error: "Unknown category.", n };
  // "Be specific" — reject a note that just restates the category or a bare umbrella/fuel word.
  const noteErr = validateSpendLabel(note, cat.name);
  if (noteErr) return { ok: false, error: noteErr, n };
  // Shared spend (GPay-style): the full "amount" is logged as the spend (optionally on a
  // card, deferred as usual); each other person's share becomes its own lent receivable
  // that posts back as income when received. "myShare" is what's left for you.
  const shared = formData.get("shared") === "on";
  // Reimbursement: the WHOLE spend comes back (not a split). Same accounting as a split
  // where others owe 100% — it doesn't eat this month's budget, and a single "lent"
  // receivable drops cash-in-hand until it's marked received. Mutually exclusive with split.
  const reimburse = !shared && formData.get("reimburse") === "on";
  const card = await resolveSpendCard(member.id, formData); // any household card (own or peer)
  const cardAccountId = card?.id ?? null;
  // A peer-card spend already carries its own cross-person debt (you owe the card owner) — combining it
  // with a split/reimbursement would double the receivables. Keep them separate for now.
  if (card?.isPeer && (shared || reimburse))
    return { ok: false, error: "A spend on someone else's card can't also be split or reimbursed. Log it plainly — you'll owe the card owner.", n };
  // Peer card → resolve the repay-by date (immutable from the cycle for credit; required input otherwise).
  let peerRepay: { dueDate: Date; notifyDaysBefore: number } | null = null;
  if (card?.isPeer) {
    const r = resolvePeerRepay(card, formData, new Date());
    if ("error" in r) return { ok: false, error: r.error, n };
    peerRepay = r;
  }
  let splits: { name: string; amount: number; memberId: number | null }[] = [];
  let myShare = 0;
  if (shared) {
    try {
      const raw = JSON.parse(String(formData.get("splits") ?? "[]"));
      if (Array.isArray(raw)) {
        splits = raw
          .map((s) => ({ name: String(s?.name ?? "").trim(), amount: Math.round((Number(s?.amount) || 0) * 100) / 100, memberId: Number(s?.memberId) || null }))
          .filter((s) => s.name && s.amount > 0);
      }
    } catch { splits = []; }
    const othersSum = splits.reduce((t, s) => t + s.amount, 0);
    myShare = Math.round((amount - othersSum) * 100) / 100;
    if (splits.length === 0 || othersSum > amount + 0.01 || myShare < -0.01)
      return { ok: false, error: "Check the split — the shares must add up to what you paid.", n };
  }

  // Resolve the person a reimbursement is collected from — a household member (→ mirrored + notified) or
  // a typed name (single-sided). Falls back to the spend name if nothing was entered.
  let reimbMember: { id: number; name: string } | null = null;
  let reimbName = "";
  if (reimburse) {
    const rid = Number(formData.get("reimburseMemberId")) || 0;
    if (rid && rid !== member.id) {
      const m = await prisma.member.findUnique({ where: { id: rid }, select: { id: true, name: true, householdId: true } });
      if (m && m.householdId === member.householdId) reimbMember = { id: m.id, name: m.name };
    }
    reimbName = String(formData.get("reimburseName") ?? "").trim() || reimbMember?.name || note;
  }

  // A split/reimbursement needs a "collect by" date (auto from your own credit card's cycle, else picked).
  let owed: { dueDate: Date; notifyDaysBefore: number } | null = null;
  if (shared || reimburse) {
    const r = resolveCollectBy(card, formData, new Date());
    if ("error" in r) return { ok: false, error: r.error, n };
    owed = r;
  }

  // Household members that a split/reimburse row may legitimately mirror to — guard against a crafted id
  // writing a loan onto an arbitrary member. Authoritative names come from here, not the client payload.
  const memberNameById = new Map(
    (await prisma.member.findMany({ where: { householdId: member.householdId }, select: { id: true, name: true } })).map((m) => [m.id, m.name] as const),
  );

  // others' total share — full amount when it's a reimbursement (nothing is your expense)
  const sharedOthers = shared ? Math.round((amount - myShare) * 100) / 100 : reimburse ? amount : null;
  await prisma.$transaction(async (tx) => {
    const created = await tx.personalSpend.create({ data: { memberId: member.id, periodId, categoryId, amount, note, cardAccountId, sharedOthers } });
    // A debit/prepaid card spend posts the FULL amount to the card ledger (that's what left the card).
    // A peer card posts it to the OWNER's ledger + creates the two-sided repay debt.
    await syncPersonalSpendLedger(tx, { spendId: created.id, card, amount, label: note, date: created.date, categoryName: cat.name, payerName: member.name });
    await syncPeerCardLoans(tx, { spendId: created.id, payerId: member.id, payerName: member.name, card, amount, note, dueDate: peerRepay?.dueDate ?? null, notifyDaysBefore: peerRepay?.notifyDaysBefore ?? 3 });
    for (const s of splits) {
      await createSharedReceivable(tx, {
        payerId: member.id, payerName: member.name, spendId: created.id, note,
        counterpartyMemberId: s.memberId && memberNameById.has(s.memberId) && s.memberId !== member.id ? s.memberId : null,
        counterpartyName: (s.memberId && memberNameById.get(s.memberId)) || s.name,
        owedAmount: s.amount, fullPaid: amount, myShare,
        dueDate: owed?.dueDate ?? null, notifyDaysBefore: owed?.notifyDaysBefore ?? 3,
      });
    }
    if (reimburse) {
      // one receivable for the full amount; sharedShare 0 marks it a reimbursement (nothing is your expense)
      await createSharedReceivable(tx, {
        payerId: member.id, payerName: member.name, spendId: created.id, note,
        counterpartyMemberId: reimbMember?.id ?? null,
        counterpartyName: reimbName,
        owedAmount: amount, fullPaid: amount, myShare: 0,
        dueDate: owed?.dueDate ?? null, notifyDaysBefore: owed?.notifyDaysBefore ?? 3,
      });
    }
  });
  rev();
  return { ok: true, n };
}

export async function updatePersonalSpend(
  prev: PersonalSaveState,
  formData: FormData,
): Promise<PersonalSaveState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const id = Number(formData.get("id"));
  const categoryId = Number(formData.get("categoryId"));
  const amount = parseAmount(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim();
  const s = await prisma.personalSpend.findUnique({ where: { id } });
  if (!s || s.memberId !== member.id) return { ok: false, error: "Not found.", n };
  if (!amount || amount <= 0 || !categoryId || !note)
    return { ok: false, error: "Enter a name, category and amount.", n };
  const cat = await prisma.personalCategory.findUnique({ where: { id: categoryId }, select: { memberId: true, name: true } });
  if (!cat || cat.memberId !== member.id) return { ok: false, error: "Unknown category.", n };
  const card = await resolveSpendCard(member.id, formData);
  const cardAccountId = card?.id ?? null;
  // Editing a shared/reimbursed spend onto a peer card would tangle two debt models — block it.
  if (card?.isPeer && (s.sharedOthers != null))
    return { ok: false, error: "This spend is split/reimbursed — it can't move onto someone else's card.", n };
  let peerRepay: { dueDate: Date; notifyDaysBefore: number } | null = null;
  if (card?.isPeer) {
    const r = resolvePeerRepay(card, formData, s.date);
    if ("error" in r) return { ok: false, error: r.error, n };
    peerRepay = r;
  }
  await prisma.$transaction(async (tx) => {
    await tx.personalSpend.update({ where: { id }, data: { categoryId, amount, note, cardAccountId } });
    await syncPersonalSpendLedger(tx, { spendId: id, card, amount, label: note, date: s.date, categoryName: cat.name, payerName: member.name });
    await syncPeerCardLoans(tx, { spendId: id, payerId: member.id, payerName: member.name, card, amount, note, dueDate: peerRepay?.dueDate ?? null, notifyDaysBefore: peerRepay?.notifyDaysBefore ?? 3 });
  });
  rev();
  return { ok: true, n };
}

export async function deletePersonalSpend(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const s = await prisma.personalSpend.findUnique({ where: { id } });
  if (!s || s.memberId !== member.id) return;
  await prisma.$transaction(async (tx) => {
    // Auto-created peer-card debt (borrower + lender rows) goes with the spend — spendId is SetNull on
    // the loan, so it would otherwise linger. The ledger mirror cascades on the spend delete itself.
    await tx.personalLoan.deleteMany({ where: { spendId: id, linkGroup: { not: null } } });
    await tx.personalSpend.delete({ where: { id } });
  });
  rev();
}

// ── Credit-card bills (settle a card's cycle → real cash outflow this month) ──
export async function markCardBillPaid(formData: FormData) {
  const member = await me("markCardBillPaid");
  if (!member) return;
  const cardAccountId = Number(formData.get("cardAccountId"));
  const cycleEndISO = String(formData.get("cycleEnd") ?? "");
  const amount = parseAmount(formData.get("amount"));
  const cycleTotal = parseAmount(formData.get("cycleTotal")); // tagged total for the cycle (for cashback)
  const ctx = { memberId: member.id, cardAccountId };
  if (!cardAccountId || !cycleEndISO || !amount || amount <= 0) { log.warn("markCardBillPaid", "blocked", { outcome: "blocked", reason: "bad-input", ...ctx }); return; }
  const card = await prisma.financeAccount.findUnique({ where: { id: cardAccountId }, select: { memberId: true, type: true } });
  if (!card || card.memberId !== member.id || card.type !== "credit_card") { log.warn("markCardBillPaid", "blocked", { outcome: "blocked", reason: "not-owner", ...ctx }); return; }
  const cycleEnd = new Date(cycleEndISO);
  if (isNaN(cycleEnd.getTime())) { log.warn("markCardBillPaid", "blocked", { outcome: "blocked", reason: "bad-date", ...ctx }); return; }
  // The payment leaves cash in the CURRENT open personal month.
  const period = await ensurePersonalMonth(member.id);
  // Paid less than the tagged total → the difference is a saving/cashback on that card.
  // Record it as a cashback transaction (marked by category so undo can reverse it).
  const cashbackMarker = `__billcashback__:${cycleEnd.toISOString()}`;
  const cashback = cycleTotal && cycleTotal > amount ? Math.round((cycleTotal - amount) * 100) / 100 : 0;
  await prisma.$transaction(async (tx) => {
    await tx.personalCardBill.upsert({
      where: { cardAccountId_cycleEnd: { cardAccountId, cycleEnd } },
      create: { memberId: member.id, cardAccountId, cycleEnd, paidPeriodId: period.id, amount },
      update: { amount, paidPeriodId: period.id, paidAt: new Date() },
    });
    // replace any prior cashback for this cycle (e.g. re-marking with a different amount)
    await tx.accountTransaction.deleteMany({ where: { accountId: cardAccountId, category: cashbackMarker } });
    if (cashback > 0) {
      await tx.accountTransaction.create({
        data: {
          memberId: member.id,
          accountId: cardAccountId,
          date: new Date(),
          merchant: "Bill savings / cashback",
          amount: cashback,
          type: "cashback",
          category: cashbackMarker,
          source: "manual",
        },
      });
    }
  });
  log.info("markCardBillPaid", "ok", { outcome: "ok", ...ctx, amount, cashback });
  rev();
}

export async function unmarkCardBillPaid(formData: FormData) {
  const member = await me("unmarkCardBillPaid");
  if (!member) return;
  const id = Number(formData.get("id"));
  const bill = await prisma.personalCardBill.findUnique({ where: { id } });
  if (!bill || bill.memberId !== member.id) { log.warn("unmarkCardBillPaid", "blocked", { outcome: "blocked", reason: "not-owner", memberId: member.id, id }); return; }
  const cashbackMarker = `__billcashback__:${bill.cycleEnd.toISOString()}`;
  await prisma.$transaction([
    prisma.accountTransaction.deleteMany({ where: { accountId: bill.cardAccountId, category: cashbackMarker } }),
    prisma.personalCardBill.delete({ where: { id } }),
  ]);
  log.info("unmarkCardBillPaid", "ok", { outcome: "ok", memberId: member.id, id });
  rev();
}

// ── Savings pot (personal-mode Piggy) ────────────────────────────────────────
// Set money aside into the pot. Signed: a negative amount is a manual correction/
// deduction that doesn't feed any month (use "Use in a month" for real withdrawals).
export async function depositPersonalSavings(formData: FormData) {
  const member = await me();
  if (!member) return;
  const amount = parseAmount(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!amount || Number.isNaN(amount) || amount === 0) return;
  await prisma.personalSavings.create({ data: { memberId: member.id, amount, note } });
  rev();
}

// Pull money out of the pot into a specific month — reduces the pot AND posts a one-off
// PersonalIncome to that month (so it raises that month's spendable, like Piggy → income).
// Guarded so you can never withdraw more than the pot holds.
export async function withdrawPersonalSavings(formData: FormData) {
  const member = await me();
  if (!member) return;
  const periodId = Number(formData.get("periodId"));
  const amount = parseAmount(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim() || "Savings";
  if (!periodId || !amount || amount <= 0) return;
  const period = await ownsPeriod(member.id, periodId);
  if (!period) return;
  const bal = (await prisma.personalSavings.aggregate({ where: { memberId: member.id }, _sum: { amount: true } }))._sum.amount ?? 0;
  if (amount > bal) return; // overdraw blocked (UI also guards)
  await prisma.$transaction([
    prisma.personalSavings.create({ data: { memberId: member.id, periodId, amount: -amount, note: `Used in ${period.label}: ${note}` } }),
    prisma.personalIncome.create({ data: { memberId: member.id, periodId, source: `From Savings: ${note}`, amount } }),
  ]);
  rev();
}

// ── Next-month preview (personal draft) ──────────────────────────────────────
export async function createPersonalPreview() {
  const member = await me();
  if (!member) return;
  const draft = await ensurePersonalPreview(member.id);
  rev();
  if (draft) redirect(`/personal/sheet?y=${draft.year}&m=${draft.month}`);
}

export async function rebuildPersonalPreviewAction(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("periodId"));
  await rebuildPersonalPreview(member.id, id);
  rev();
}

export async function discardPersonalPreview(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("periodId"));
  const draft = await prisma.personalPeriod.findUnique({ where: { id } });
  if (!draft || draft.memberId !== member.id || draft.status !== "draft") return;
  await prisma.personalPeriod.delete({ where: { id } });
  rev();
  redirect("/personal/sheet");
}

// ── Categories (spend categories — managed in the Expenses tab) ──────────────
export async function addPersonalCategory(formData: FormData) {
  const member = await me();
  if (!member) return;
  const name = String(formData.get("name") ?? "").trim();
  const icon = String(formData.get("icon") ?? "").trim() || "🔖";
  if (!name) return;
  try {
    await prisma.personalCategory.create({ data: { memberId: member.id, name, icon, sortOrder: 999 } });
  } catch {
    /* duplicate — ignore */
  }
  rev();
}

export async function archivePersonalCategory(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const c = await prisma.personalCategory.findUnique({ where: { id } });
  if (!c || c.memberId !== member.id) return;
  await prisma.personalCategory.update({ where: { id }, data: { archived: !c.archived } });
  rev();
}

// ── Settings ─────────────────────────────────────────────────────────────────
export async function setPersonalWindDownDay(formData: FormData) {
  const member = await me();
  if (!member) return;
  const raw = String(formData.get("windDownDay") ?? "").trim();
  const day = raw === "" ? null : Number(raw);
  if (day != null && (Number.isNaN(day) || day < 1 || day > 28)) return;
  await prisma.member.update({ where: { id: member.id }, data: { personalWindDownDay: day } });
  rev();
}

// ── Lending & borrowing ──────────────────────────────────────────────────────
export async function addPersonalLoan(formData: FormData) {
  const member = await me();
  if (!member) return;
  const direction = String(formData.get("direction")) === "borrowed" ? "borrowed" : "lent";
  const amount = parseAmount(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!amount || amount <= 0) return;
  // Repay-by date → drives the bell + top-bar reminder. notifyDaysBefore = how many days ahead the
  // nudge starts (default 3).
  const repayRaw = String(formData.get("repayBy") ?? "").trim();
  const dueDate = repayRaw ? new Date(`${repayRaw}T00:00:00`) : null;
  const nd = Number(formData.get("notifyDaysBefore"));
  const notifyDaysBefore = Number.isFinite(nd) && nd >= 0 ? Math.round(nd) : 3;

  // Counterparty is either a household MEMBER (→ mirror to their Lending tab, two-sided) or a free-text
  // name (single-sided, as before).
  const cpMemberId = Number(formData.get("counterpartyMemberId")) || 0;
  let cpMember: { id: number; name: string } | null = null;
  if (cpMemberId && cpMemberId !== member.id) {
    const m = await prisma.member.findUnique({ where: { id: cpMemberId }, select: { id: true, name: true, householdId: true } });
    if (m && m.householdId === member.householdId) cpMember = { id: m.id, name: m.name };
  }

  if (cpMember) {
    // Two linked rows sharing a linkGroup — it shows in BOTH members' tabs (you lent ⇄ they borrowed),
    // and settling/recording/deleting either side clears both (loanGroupWhere).
    const linkGroup = randomUUID();
    const opp = direction === "borrowed" ? "lent" : "borrowed";
    const common = { amount, outstanding: amount, note, dueDate, notifyDaysBefore, linkGroup, initiatedById: member.id };
    await prisma.personalLoan.createMany({
      data: [
        { memberId: member.id, direction, counterparty: cpMember.name, ...common },
        { memberId: cpMember.id, direction: opp, counterparty: member.name, ...common },
      ],
    });
  } else {
    const counterparty = String(formData.get("counterparty") ?? "").trim();
    if (!counterparty) return;
    await prisma.personalLoan.create({
      data: { memberId: member.id, direction, counterparty, amount, outstanding: amount, note, dueDate, notifyDaysBefore },
    });
  }
  rev();
}

// A peer-card loan has TWO rows (borrower + lender) sharing a linkGroup. Any mutation applies to the
// whole group so settling/recording/deleting from EITHER member's Lending tab clears both sides. A
// plain loan (no linkGroup) is just itself.
function loanGroupWhere(loan: { id: number; linkGroup: string | null }): Prisma.PersonalLoanWhereInput {
  return loan.linkGroup ? { linkGroup: loan.linkGroup } : { id: loan.id };
}

// Paying off a debt YOU owe is real cash leaving your hand — it should register as a spend so "Can
// spend" drops. This applies to a BORROWED loan that isn't already in your budget: a peer-card spend you
// logged yourself carries a cardAccountId (counted at spend time) and is skipped; split/shared debts and
// manual borrows are not, so they log. Receiving money you're owed (lent side) is untouched.
type SettleLoan = { direction: string; cardAccountId: number | null; counterparty: string; note: string | null };
function shouldLogSettlement(loan: SettleLoan): boolean {
  return loan.direction === "borrowed" && loan.cardAccountId == null;
}
// Resolve + validate the category up front (before we mutate anything), so a settlement never clears the
// debt without also logging the expense. Returns null when no expense should be logged.
async function resolveSettleCategory(memberId: number, loan: SettleLoan, formData: FormData): Promise<number | null> {
  if (!shouldLogSettlement(loan)) return null;
  const id = Number(formData.get("settleCategoryId")) || 0;
  const cat = await prisma.personalCategory.findFirst({ where: { id, memberId }, select: { id: true } });
  if (!cat) throw new Error("Pick a category for this settlement.");
  return cat.id;
}
async function createSettlementSpend(member: { id: number }, loan: SettleLoan, paid: number, categoryId: number) {
  if (paid <= 0) return;
  const period = await ensurePersonalMonth(member.id);
  const label = `Settled with ${loan.counterparty}${loan.note ? ` · ${loan.note}` : ""}`;
  await prisma.personalSpend.create({ data: { memberId: member.id, periodId: period.id, categoryId, amount: paid, note: label } });
}

export async function recordPersonalLoanPayment(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const pay = parseAmount(formData.get("amount"));
  const loan = await prisma.personalLoan.findUnique({ where: { id } });
  if (!loan || loan.memberId !== member.id || !pay || pay <= 0) return;
  const settleCat = await resolveSettleCategory(member.id, loan, formData); // throws if a category is required but missing
  const applied = Math.min(pay, loan.outstanding); // never log more than what was owed
  const outstanding = Math.max(0, loan.outstanding - pay);
  // A repayment on a lent loan (money coming BACK to you) just settles it — cash-in-hand already excluded
  // it. A repayment on a borrowed loan is cash going OUT → logged below as a spend.
  await prisma.personalLoan.updateMany({
    where: loanGroupWhere(loan),
    data: { outstanding, status: outstanding <= 0.005 ? "settled" : "open" },
  });
  if (settleCat != null) await createSettlementSpend(member, loan, applied, settleCat);
  rev();
}

export async function settlePersonalLoan(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const loan = await prisma.personalLoan.findUnique({ where: { id } });
  if (!loan || loan.memberId !== member.id) return;
  const settleCat = await resolveSettleCategory(member.id, loan, formData); // throws if a category is required but missing
  const paid = loan.outstanding; // the amount cleared right now
  await prisma.personalLoan.updateMany({ where: loanGroupWhere(loan), data: { outstanding: 0, status: "settled" } });
  if (settleCat != null) await createSettlementSpend(member, loan, paid, settleCat);
  rev();
}

export async function deletePersonalLoan(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const loan = await prisma.personalLoan.findUnique({ where: { id } });
  if (!loan || loan.memberId !== member.id) return;
  await prisma.personalLoan.deleteMany({ where: loanGroupWhere(loan) });
  rev();
}

// Rename a whole person group — every lend/borrow (open OR settled) filed under the old
// name in this direction gets recorded against the new name, so the group stays merged.
export async function renamePersonalLoanParty(formData: FormData) {
  const member = await me();
  if (!member) return;
  const oldName = String(formData.get("oldName") ?? "").trim();
  const newName = String(formData.get("newName") ?? "").trim();
  const direction = String(formData.get("direction")) === "borrowed" ? "borrowed" : "lent";
  if (!oldName || !newName || oldName === newName) return;
  await prisma.personalLoan.updateMany({
    where: { memberId: member.id, direction, counterparty: oldName },
    data: { counterparty: newName },
  });
  rev();
}
