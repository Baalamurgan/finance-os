"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { revalidateFamily } from "@/lib/revalidate";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { parseAmount, formatINR } from "@/lib/format";
import { istTodayStartMs } from "@/lib/time";
import { recordActivity } from "@/lib/activity";
import { validateSpendLabel } from "@/lib/spendCategorize";
import { log } from "@/lib/log";
import { isPersonalUnlocked } from "@/lib/personal-lock";
import { ensurePersonalMonth, ensurePersonalPreview, rebuildPersonalPreview, seedPersonalCategories } from "@/lib/personal";
import { getCardBillReminders, getCardDues } from "@/lib/personal/cash";
import { ensurePlanSteps, orderSteps, cardBillTemplateId, decodeCardBillTemplateId } from "@/lib/personal/planSteps";
import { templateDate } from "@/lib/personal/templates";
import { addContribution, removeContributions, resolveHoldingFromForm } from "@/lib/finance/networth";
import { payFamilyCardBill, unpayFamilyCardBill } from "@/app/actions";
import { currentCycle } from "@/lib/finance/cycle";
import { BALANCE_ACCOUNT_TYPES } from "@/lib/finance/types";

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
  const t0 = istTodayStartMs(); // IST today — not the UTC server day (a raw new Date() lags until 5:30am IST)
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
// The member's PERSONAL account (marked, or their only bank/cash/wallet account) — where a "UPI" spend with
// no account picked, and lending money in/out, actually moves. null = none → those just don't post.
async function personalAccountIdOf(tx: Prisma.TransactionClient, memberId: number): Promise<number | null> {
  const accts = await tx.financeAccount.findMany({ where: { memberId, active: true, type: { in: [...BALANCE_ACCOUNT_TYPES] } }, select: { id: true, personalPrimary: true } });
  return (accts.find((a) => a.personalPrimary) ?? (accts.length === 1 ? accts[0] : null))?.id ?? null;
}

async function syncPersonalSpendLedger(
  tx: Prisma.TransactionClient,
  a: { spendId: number; card: SpendCard | null; amount: number; label: string; date: Date; categoryName: string | null; payerName: string; memberId?: number },
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
    // No account picked (UPI) → it leaves the PERSONAL account, so its balance tracks your Can spend. Only for a
    // spend in a month that's still running (an old month's spend was already in that account's balance), and
    // not for a planned spend paid from a chosen bank (that one posts its own marked line).
    const sp = a.memberId != null ? await tx.personalSpend.findUnique({ where: { id: a.spendId }, select: { payAccountId: true, pending: true, period: { select: { status: true } } } }) : null;
    const personalId = a.memberId != null && sp && !sp.pending && sp.payAccountId == null && sp.period.status !== "closed" ? await personalAccountIdOf(tx, a.memberId) : null;
    if (personalId != null) {
      await tx.accountTransaction.upsert({
        where: { personalSpendId: a.spendId },
        update: { amount: a.amount, merchant: a.label, accountId: personalId, memberId: a.memberId!, source: "personal" },
        create: { memberId: a.memberId!, accountId: personalId, date: a.date, merchant: a.label, amount: a.amount, type: "spend", category: a.categoryName, source: "personal", personalSpendId: a.spendId },
      });
    } else {
      await tx.accountTransaction.deleteMany({ where: { personalSpendId: a.spendId } });
    }
  }
}

// Resolve the member's OWN balance account an extra income was deposited into (bank / cash / debit /
// prepaid), or null for untracked. Guards a crafted id: must be the member's own active balance account.
async function resolveIncomeAccount(memberId: number, formData: FormData): Promise<number | null> {
  const raw = Number(formData.get("accountId"));
  if (!raw) return null;
  const acc = await prisma.financeAccount.findFirst({ where: { id: raw, memberId, active: true }, select: { id: true, type: true } });
  return acc && BALANCE_ACCOUNT_TYPES.has(acc.type) ? acc.id : null;
}

// Keep a balance account's LEDGER in sync with an extra income tagged to it, so the deposit shows as a line
// item and raises the account's balance. View-layer + opt-in: the month's spendable (getPersonalCash) counts
// the income regardless. Idempotent: upsert on the income link, or remove the line if it moved back to
// untracked. Deleting the income cascades the line away via the personalIncomeId FK.
async function syncPersonalIncomeLedger(
  tx: Prisma.TransactionClient,
  a: { incomeId: number; memberId: number; accountId: number | null; amount: number; source: string; date: Date },
) {
  if (a.accountId) {
    await tx.accountTransaction.upsert({
      where: { personalIncomeId: a.incomeId },
      update: { amount: a.amount, merchant: a.source || "Income", accountId: a.accountId },
      create: { memberId: a.memberId, accountId: a.accountId, date: a.date, merchant: a.source || "Income", amount: a.amount, type: "topup", source: "manual", personalIncomeId: a.incomeId },
    });
  } else {
    await tx.accountTransaction.deleteMany({ where: { personalIncomeId: a.incomeId } });
  }
}

// Create / refresh / remove the two-sided peer-card debt for a spend. Called after the spend row is
// written. Idempotent: it clears any prior peer pair for this spend, then (if the spend is on a peer
// card) writes a fresh borrower + lender pair sharing a linkGroup, so settling/deleting either clears
// both. The repay-by date is derived from the card cycle (credit) and is immutable in the UI.
async function syncPeerCardLoans(
  tx: Prisma.TransactionClient,
  a: { spendId: number; payerId: number; payerName: string; card: SpendCard | null; amount: number; note: string; dueDate: Date | null; notifyDaysBefore: number; date?: Date },
) {
  // Only the PEER-CARD pair (rows with a cardAccountId) is touched here. Member-split / reimbursement
  // receivables also share a linkGroup but have no cardAccountId — left alone, or editing an unrelated
  // field would wipe the split debt.
  const prior = await tx.personalLoan.findMany({ where: { spendId: a.spendId, cardAccountId: { not: null } }, select: { id: true, amount: true, outstanding: true, cardAccountId: true, linkGroup: true } });
  // Same peer card as before (an edit of name/amount/category) → UPDATE the pair in place, keeping what's
  // already been repaid (and its original date + link). Re-creating it reset repayments and re-opened a
  // settled debt. A changed amount moves the outstanding by the same delta (never below 0).
  if (a.card?.isPeer && prior.length > 0 && prior.every((l) => l.cardAccountId === a.card!.id)) {
    const r2 = (x: number) => Math.round(x * 100) / 100;
    for (const l of prior) {
      const paid = Math.max(0, r2(l.amount - l.outstanding));
      const outstanding = Math.max(0, r2(a.amount - paid));
      await tx.personalLoan.update({ where: { id: l.id }, data: { amount: a.amount, outstanding, note: a.note, dueDate: a.dueDate, notifyDaysBefore: a.notifyDaysBefore, status: outstanding <= 0.005 ? "settled" : "open" } });
    }
    return;
  }
  await tx.personalLoan.deleteMany({ where: { spendId: a.spendId, cardAccountId: { not: null } } });
  if (!a.card || !a.card.isPeer) return;
  const linkGroup = randomUUID();
  // dated to the spend (an edit that moves a spend onto a peer card shouldn't date the debt "today")
  const common = { amount: a.amount, outstanding: a.amount, note: a.note, spendId: a.spendId, linkGroup, cardAccountId: a.card.id, dueDate: a.dueDate, notifyDaysBefore: a.notifyDaysBefore, initiatedById: a.payerId, ...(a.date ? { createdAt: a.date } : {}) };
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
    createdAt?: Date; // edit-time split → date the Lending entry to the spend's own date
  },
) {
  const linkGroup = a.counterpartyMemberId ? randomUUID() : null;
  const at = a.createdAt ? { createdAt: a.createdAt } : {};
  await tx.personalLoan.create({
    data: {
      memberId: a.payerId, direction: "lent", counterparty: a.counterpartyName,
      amount: a.owedAmount, outstanding: a.owedAmount, note: a.note,
      sharedPaid: a.fullPaid, sharedShare: a.myShare, spendId: a.spendId,
      dueDate: a.dueDate, notifyDaysBefore: a.notifyDaysBefore, linkGroup, initiatedById: a.payerId, ...at,
    },
  });
  if (a.counterpartyMemberId && linkGroup) {
    await tx.personalLoan.create({
      data: {
        memberId: a.counterpartyMemberId, direction: "borrowed", counterparty: a.payerName,
        amount: a.owedAmount, outstanding: a.owedAmount, note: a.note, spendId: a.spendId,
        dueDate: a.dueDate, notifyDaysBefore: a.notifyDaysBefore, linkGroup, initiatedById: a.payerId, ...at,
      },
    });
  }
}

// Split / reimbursement input from the spend modal (shared by add + edit). Validates the shares against
// what was paid and resolves a reimbursement's counterparty (household member → mirrored, else a name).
type SplitInput = {
  shared: boolean; reimburse: boolean;
  splits: { name: string; amount: number; memberId: number | null }[]; myShare: number;
  reimbMember: { id: number; name: string } | null; reimbName: string;
};
async function parseSplitInput(
  formData: FormData, amount: number, note: string, member: { id: number; householdId: number },
): Promise<SplitInput | { error: string }> {
  const shared = formData.get("shared") === "on";
  const reimburse = !shared && formData.get("reimburse") === "on";
  let splits: SplitInput["splits"] = [];
  let myShare = 0;
  if (shared) {
    try {
      const raw = JSON.parse(String(formData.get("splits") ?? "[]"));
      if (Array.isArray(raw)) {
        splits = raw
          .map((x) => ({ name: String(x?.name ?? "").trim(), amount: Math.round((Number(x?.amount) || 0) * 100) / 100, memberId: Number(x?.memberId) || null }))
          .filter((x) => x.name && x.amount > 0);
      }
    } catch { splits = []; }
    const othersSum = splits.reduce((t, x) => t + x.amount, 0);
    myShare = Math.round((amount - othersSum) * 100) / 100;
    if (splits.length === 0 || othersSum > amount + 0.01 || myShare < -0.01)
      return { error: "Check the split — the shares must add up to what you paid." };
  }
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
  return { shared, reimburse, splits, myShare, reimbMember, reimbName };
}

// Write a spend's split / reimbursement receivables (Lending rows; member counterparties get a mirrored
// "borrowed" row). Returns the spend's sharedOthers (Σ others' shares; full amount for a reimbursement).
async function writeSplitReceivables(
  tx: Prisma.TransactionClient,
  a: { member: { id: number; name: string; householdId: number }; spendId: number; note: string; amount: number; input: SplitInput; owed: { dueDate: Date; notifyDaysBefore: number } | null; createdAt?: Date },
): Promise<number | null> {
  const { input } = a;
  // Household members a split row may mirror to — guards a crafted id; authoritative names come from here.
  const memberNameById = new Map(
    (await tx.member.findMany({ where: { householdId: a.member.householdId }, select: { id: true, name: true } })).map((m) => [m.id, m.name] as const),
  );
  const common = { payerId: a.member.id, payerName: a.member.name, spendId: a.spendId, note: a.note, dueDate: a.owed?.dueDate ?? null, notifyDaysBefore: a.owed?.notifyDaysBefore ?? 3, createdAt: a.createdAt };
  for (const x of input.splits) {
    await createSharedReceivable(tx, {
      ...common,
      counterpartyMemberId: x.memberId && memberNameById.has(x.memberId) && x.memberId !== a.member.id ? x.memberId : null,
      counterpartyName: (x.memberId && memberNameById.get(x.memberId)) || x.name,
      owedAmount: x.amount, fullPaid: a.amount, myShare: input.myShare,
    });
  }
  if (input.reimburse) {
    // one receivable for the full amount; sharedShare 0 marks it a reimbursement (nothing is your expense)
    await createSharedReceivable(tx, {
      ...common,
      counterpartyMemberId: input.reimbMember?.id ?? null, counterpartyName: input.reimbName,
      owedAmount: a.amount, fullPaid: a.amount, myShare: 0,
    });
  }
  return input.shared ? Math.round((a.amount - input.myShare) * 100) / 100 : input.reimburse ? a.amount : null;
}

// A spend's split/reimbursement can be rewritten only while NOTHING has moved on it: every receivable
// (and its member mirror) still fully open, and none dropped (a dropped one means you bore that share).
async function splitLockReason(spendId: number, sharedOthers: number | null): Promise<string | null> {
  if (sharedOthers == null) return null;
  const rows = await prisma.personalLoan.findMany({ where: { spendId, cardAccountId: null }, select: { direction: true, amount: true, outstanding: true, status: true, counterparty: true } });
  const moved = rows.find((l) => l.status !== "open" || l.outstanding < l.amount - 0.005);
  if (moved) return `${moved.direction === "lent" ? moved.counterparty : "Someone"} has already paid back part of this — undo that in Lending first to change the split.`;
  const lentTotal = rows.filter((l) => l.direction === "lent").reduce((t, l) => t + l.amount, 0);
  if (lentTotal < sharedOthers - 0.005) return "A share on this spend was dropped (you bore it) — the split can't be changed now.";
  return null;
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
      // Setup template (repeats every month) + this month's own copy of it.
      const t = await prisma.personalTemplate.create({ data: { memberId: member.id, kind: "expense", label: labels[i], categoryId: catIds[i], amount: amts[i], dayOfMonth: 1 } });
      await prisma.personalExpense.create({
        data: { memberId: member.id, periodId: period.id, label: labels[i], categoryId: catIds[i], amount: amts[i], recurring: true, templateId: t.id },
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
  const data: { income: number; incomeAccountId?: number | null } = { income };
  // The income form may carry a target account for the salary (empty = budget-only).
  if (formData.has("incomeAccountId")) data.incomeAccountId = await ownBalanceAccountId(member.id, formData.get("incomeAccountId"));
  await prisma.personalPeriod.update({ where: { id: periodId }, data });
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
  // Optionally deposit it into one of the member's balance accounts (bank/cash/…) — raises that account's
  // balance via a mirror ledger line. null = untracked (just raises the month's spendable).
  const accountId = await resolveIncomeAccount(member.id, formData);
  await prisma.$transaction(async (tx) => {
    const created = await tx.personalIncome.create({ data: { memberId: member.id, periodId, source, amount, accountId } });
    await syncPersonalIncomeLedger(tx, { incomeId: created.id, memberId: member.id, accountId, amount, source, date: created.date });
  });
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
  await prisma.$transaction(async (tx) => {
    // "Repeat every month" → also a Setup template (from next month it's copied in like any other); this
    // month's line is its own copy, so later edits to either never touch the other.
    const t = recurring ? await tx.personalTemplate.create({ data: { memberId: member.id, kind: "expense", label, categoryId, amount, cardAccountId, dayOfMonth: new Date().getDate() > 28 ? 28 : new Date().getDate() } }) : null;
    await tx.personalExpense.create({ data: { memberId: member.id, periodId, label, categoryId, amount, recurring, cardAccountId, templateId: t?.id ?? null } });
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
  const e = await prisma.personalExpense.findUnique({ where: { id } });
  if (!e || e.memberId !== member.id) return { ok: false, error: "Not found.", n };
  if (!label || !categoryId || !amount || amount <= 0)
    return { ok: false, error: "Enter a name, category and amount.", n };
  const cardAccountId = await ccCardId(member.id, formData);
  // This month's line only — Setup (its template) is never touched from the Sheet.
  await prisma.personalExpense.update({ where: { id }, data: { label, categoryId, amount, cardAccountId } });
  rev();
  return { ok: true, n };
}

// ── Recurring setup templates (income / fixed expense / daily spend) ──────────────────────────────────
// Setup = PersonalTemplate rows, kept apart from the months. Adding / editing / deleting one here only shapes
// the months created AFTER it (each new month copies the active templates). The current month changes only
// via "Apply to this month" (applyTemplateToMonth) — never as a side effect of editing Setup.
export async function upsertPersonalRecurring(prev: PersonalSaveState, formData: FormData): Promise<PersonalSaveState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const kind = String(formData.get("kind"));
  if (kind !== "income" && kind !== "expense" && kind !== "spend") return { ok: false, error: "Bad type.", n };
  const id = Number(formData.get("id")) || 0;
  const label = String(formData.get("label") ?? "").trim();
  const amount = parseAmount(formData.get("amount"));
  const categoryId = Number(formData.get("categoryId")) || 0;
  const dayOfMonth = Math.min(28, Math.max(1, Math.round(Number(formData.get("day")) || 1)));
  if (!label || !amount || amount <= 0) return { ok: false, error: "Enter a name and amount.", n };
  if ((kind === "expense" || kind === "spend") && !categoryId) return { ok: false, error: "Pick a category.", n };
  if (categoryId) {
    const cat = await prisma.personalCategory.findFirst({ where: { id: categoryId, memberId: member.id }, select: { id: true } });
    if (!cat) return { ok: false, error: "Unknown category.", n };
  }
  // "Paid from" can be ANY of the member's accounts: a card (credit/debit/prepaid) → cardAccountId (card-deferred
  // accounting), a bank/cash account → payAccountId (debited when the step is ticked).
  const payAcct = kind === "income" ? null : await ownAccount(member.id, formData.get("payAccountId"));
  const isCardAcct = payAcct != null && payAcct.type !== "bank" && payAcct.type !== "cash";
  // An investment bill/spend can name the holding each payment adds to (must be the member's own asset).
  const holdingId = kind !== "income" ? await resolveHoldingFromForm(member.id, formData, label) : null;
  const data = {
    holdingId,
    label: label.slice(0, 120), amount: Math.round(amount * 100) / 100, dayOfMonth,
    categoryId: kind === "income" ? null : categoryId,
    cardAccountId: isCardAcct ? payAcct!.id : null,
    payAccountId: payAcct != null && !isCardAcct ? payAcct.id : null,
    // Recurring income can name the balance account it lands in → the income step's account.
    accountId: kind === "income" ? await ownBalanceAccountId(member.id, formData.get("accountId")) : null,
  };
  if (id) {
    const t = await prisma.personalTemplate.findFirst({ where: { id, memberId: member.id, kind } });
    if (!t) return { ok: false, error: "Not found.", n };
    await prisma.personalTemplate.update({ where: { id }, data });
  } else {
    await prisma.personalTemplate.create({ data: { memberId: member.id, kind, ...data } });
  }
  rev();
  return { ok: true, n };
}

// Remove a Setup template: stops it repeating from next month. This month's copy (if any) stays as it is.
export async function deletePersonalRecurring(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  if (!id) return;
  await prisma.personalTemplate.deleteMany({ where: { id, memberId: member.id } });
  rev();
}

// "Apply to this month": copy a Setup template's CURRENT values onto the given month's own line (creating it if
// the month has none). Refused once that line is paid/received — untick it first. Its pending plan step follows
// the line (ensurePlanSteps syncs it).
export async function applyTemplateToMonth(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const member = await me();
  if (!member) return { ok: false, error: "Signed out." };
  const id = Number(formData.get("id"));
  const periodId = Number(formData.get("periodId"));
  const t = await prisma.personalTemplate.findFirst({ where: { id, memberId: member.id } });
  const period = await prisma.personalPeriod.findFirst({ where: { id: periodId, memberId: member.id }, select: { id: true, year: true, month: true, status: true } });
  if (!t || !period) return { ok: false, error: "Not found." };
  if (period.status === "closed") return { ok: false, error: "That month is closed." };
  const date = templateDate(period.year, period.month, t.dayOfMonth);
  const err = await prisma.$transaction(async (tx): Promise<string | null> => {
    if (t.kind === "income") {
      const row = await tx.personalIncome.findFirst({ where: { periodId, templateId: t.id } });
      if (row) {
        const doneStep = await tx.personalPlanStep.findFirst({ where: { periodId, templateKind: "income", templateId: row.id, status: "done" }, select: { id: true } });
        if (doneStep) return "Already received this month — untick it in the plan first.";
        await tx.personalIncome.update({ where: { id: row.id }, data: { source: t.label, amount: t.amount, date, accountId: t.accountId } });
      } else {
        await tx.personalIncome.create({ data: { memberId: member.id, periodId, source: t.label, amount: t.amount, date, recurring: true, accountId: t.accountId, templateId: t.id } });
      }
    } else if (t.kind === "expense" && t.categoryId != null) {
      const row = await tx.personalExpense.findFirst({ where: { periodId, templateId: t.id } });
      if (row && !row.pending) return "Already paid this month — untick it in the plan first.";
      const data = { label: t.label, categoryId: t.categoryId, amount: t.amount, date, cardAccountId: t.cardAccountId, payAccountId: t.payAccountId, holdingId: t.holdingId };
      if (row) await tx.personalExpense.update({ where: { id: row.id }, data });
      else await tx.personalExpense.create({ data: { memberId: member.id, periodId, ...data, recurring: true, pending: true, templateId: t.id } });
    } else if (t.kind === "spend" && t.categoryId != null) {
      const row = await tx.personalSpend.findFirst({ where: { periodId, templateId: t.id } });
      if (row && !row.pending) return "Already paid this month — edit it in Spends instead.";
      const data = { categoryId: t.categoryId, amount: t.amount, note: t.label, date, cardAccountId: t.cardAccountId, payAccountId: t.payAccountId, holdingId: t.holdingId };
      if (row) await tx.personalSpend.update({ where: { id: row.id }, data });
      else await tx.personalSpend.create({ data: { memberId: member.id, periodId, ...data, recurring: true, pending: true, templateId: t.id } });
    }
    return null;
  });
  if (err) return { ok: false, error: err };
  await ensurePlanSteps(member.id, periodId);
  rev();
  return { ok: true };
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
  // Shared spend (GPay-style): the full "amount" is logged as the spend (optionally on a card, deferred as
  // usual); each other person's share becomes its own lent receivable that posts back as income when
  // received. Reimbursement: the WHOLE spend comes back — one receivable, nothing is your expense.
  const parsed = await parseSplitInput(formData, amount, note, member);
  if ("error" in parsed) return { ok: false, error: parsed.error, n };
  const { shared, reimburse } = parsed;
  const card = await resolveSpendCard(member.id, formData); // any household card (own or peer)
  const cardAccountId = card?.id ?? null;
  // A peer-card spend may ALSO be split/reimbursed: you owe the card owner the FULL amount (their card
  // carries it — the peer debt rows have a cardAccountId), while others owe you their shares (separate
  // receivables, no cardAccountId). Two independent debts, so nothing doubles.
  // Peer card → resolve the repay-by date (immutable from the cycle for credit; required input otherwise).
  let peerRepay: { dueDate: Date; notifyDaysBefore: number } | null = null;
  if (card?.isPeer) {
    const r = resolvePeerRepay(card, formData, new Date());
    if ("error" in r) return { ok: false, error: r.error, n };
    peerRepay = r;
  }

  // A split/reimbursement needs a "collect by" date (auto from your own credit card's cycle, else picked).
  let owed: { dueDate: Date; notifyDaysBefore: number } | null = null;
  if (shared || reimburse) {
    const r = resolveCollectBy(card, formData, new Date());
    if ("error" in r) return { ok: false, error: r.error, n };
    owed = r;
  }

  await prisma.$transaction(async (tx) => {
    const created = await tx.personalSpend.create({ data: { memberId: member.id, periodId, categoryId, amount, note, cardAccountId } });
    // A debit/prepaid card spend posts the FULL amount to the card ledger (that's what left the card).
    // A peer card posts it to the OWNER's ledger + creates the two-sided repay debt.
    await syncPersonalSpendLedger(tx, { spendId: created.id, card, amount, label: note, date: created.date, categoryName: cat.name, payerName: member.name, memberId: member.id });
    await syncPeerCardLoans(tx, { spendId: created.id, payerId: member.id, payerName: member.name, card, amount, note, dueDate: peerRepay?.dueDate ?? null, notifyDaysBefore: peerRepay?.notifyDaysBefore ?? 3 });
    const sharedOthers = await writeSplitReceivables(tx, { member, spendId: created.id, note, amount, input: parsed, owed });
    if (sharedOthers != null) await tx.personalSpend.update({ where: { id: created.id }, data: { sharedOthers } });
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
  // Split / reimbursement changed in the edit modal (the modal sends splitEdit only when you touched it).
  // Same rules as a new spend, plus: open month only (a closed month's leftover already carried), and
  // only while nothing has been paid back or dropped. The receivables are rebuilt, dated to the spend.
  const splitEdit = formData.get("splitEdit") === "on";
  let splitInput: SplitInput | null = null;
  let splitOwed: { dueDate: Date; notifyDaysBefore: number } | null = null;
  if (splitEdit) {
    const p = await prisma.personalPeriod.findUnique({ where: { id: s.periodId }, select: { status: true } });
    if (p?.status !== "open") return { ok: false, error: "Splits and reimbursements can only be changed on a spend in the open month.", n };
    const lock = await splitLockReason(id, s.sharedOthers);
    if (lock) return { ok: false, error: lock, n };
    const parsed = await parseSplitInput(formData, amount, note, member);
    if ("error" in parsed) return { ok: false, error: parsed.error, n };
    splitInput = parsed;
    if (parsed.shared || parsed.reimburse) {
      const r = resolveCollectBy(card, formData, s.date);
      if ("error" in r) return { ok: false, error: r.error, n };
      splitOwed = r;
    }
  }
  // (A peer card + split is fine: you owe the owner the full amount; others owe you their shares.)
  let peerRepay: { dueDate: Date; notifyDaysBefore: number } | null = null;
  if (card?.isPeer) {
    const r = resolvePeerRepay(card, formData, s.date);
    if ("error" in r) return { ok: false, error: r.error, n };
    peerRepay = r;
  }

  // Keep split/reimbursement receivables in step with an edited amount (Model A: your share is the
  // residual = amount − Σ others' shares). A full reimbursement's single receivable tracks the new
  // amount; a split keeps others' shares and lets your share absorb the change — never below what's owed.
  const r2 = (x: number) => Math.round(x * 100) / 100;
  let spendSync: null | { sharedOthers: number; reimburseLoan: { id: number; linkGroup: string | null; amount: number; outstanding: number } | null } = null;
  if (!splitInput && s.sharedOthers != null && Math.abs(amount - s.amount) > 0.005) {
    const lent = await prisma.personalLoan.findMany({ where: { spendId: id, direction: "lent" }, select: { id: true, linkGroup: true, amount: true, outstanding: true } });
    const owed = r2(lent.reduce((t, l) => t + l.amount, 0));
    const wasReimburse = Math.abs(s.amount - s.sharedOthers) <= 0.005;
    if (wasReimburse && lent.length === 1) {
      spendSync = { sharedOthers: amount, reimburseLoan: lent[0] };
    } else {
      if (owed > amount + 0.005) return { ok: false, error: "That's less than what others still owe you — adjust the split first.", n };
      spendSync = { sharedOthers: owed, reimburseLoan: null };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.personalSpend.update({ where: { id }, data: { categoryId, amount, note, cardAccountId, ...(spendSync ? { sharedOthers: spendSync.sharedOthers } : {}) } });
    // A paid invest spend's holding contribution follows an amount edit (history + value move by the difference).
    if (Math.abs(amount - s.amount) > 0.005) {
      for (const e of await tx.netWorthEntry.findMany({ where: { memberId: member.id, kind: "contribution", spendId: id }, select: { id: true, itemId: true, amount: true } })) {
        await tx.netWorthEntry.update({ where: { id: e.id }, data: { amount } });
        await tx.netWorthItem.update({ where: { id: e.itemId }, data: { value: { increment: Math.round((amount - e.amount) * 100) / 100 } } });
      }
    }
    await syncPersonalSpendLedger(tx, { spendId: id, card, amount, label: note, date: s.date, categoryName: cat.name, payerName: member.name, memberId: member.id });
    // 3) A paid planned spend's bank debit (Mark paid from an account) follows an amount edit too.
    if (Math.abs(amount - s.amount) > 0.005) await tx.accountTransaction.updateMany({ where: { memberId: member.id, category: SPEND_PAY_MARK(id) }, data: { amount } });
    await syncPeerCardLoans(tx, { spendId: id, payerId: member.id, payerName: member.name, card, amount, note, dueDate: peerRepay?.dueDate ?? null, notifyDaysBefore: peerRepay?.notifyDaysBefore ?? 3, date: s.date });
    if (splitInput) {
      // Rebuild: drop the old (untouched) split/reimbursement rows — both sides; peer-card debt rows carry a
      // cardAccountId and are left to syncPeerCardLoans — then write the new ones dated to the spend.
      await tx.personalLoan.deleteMany({ where: { spendId: id, cardAccountId: null } });
      const sharedOthers = await writeSplitReceivables(tx, { member, spendId: id, note, amount, input: splitInput, owed: splitOwed, createdAt: s.date });
      await tx.personalSpend.update({ where: { id }, data: { sharedOthers } });
    } else if (spendSync?.reimburseLoan) {
      const l = spendSync.reimburseLoan;
      const paid = Math.max(0, r2(l.amount - l.outstanding));
      const newOut = Math.max(0, r2(amount - paid));
      await tx.personalLoan.updateMany({ where: l.linkGroup ? { linkGroup: l.linkGroup } : { id: l.id }, data: { amount, outstanding: newOut, sharedPaid: amount, status: newOut <= 0.005 ? "settled" : "open" } });
    } else if (spendSync) {
      await tx.personalLoan.updateMany({ where: { spendId: id, direction: "lent" }, data: { sharedPaid: amount, sharedShare: r2(amount - spendSync.sharedOthers) } });
    }
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
    // Deleting a spend removes EVERYTHING it created: every loan row tied to it — peer-card debt,
    // member-split mirror AND single-sided split/reimbursement receivables (all carry this spendId, both
    // sides) — and the card-ledger line (cascades via the personalSpendId FK). Nothing left dangling.
    await tx.personalLoan.deleteMany({ where: { spendId: id } });
    await tx.accountTransaction.deleteMany({ where: { memberId: member.id, category: SPEND_PAY_MARK(id) } }); // bank/cash debit from a Mark-paid
    // …and any holding contribution its payment made (paid from Spends, or via its plan step).
    await removeContributions(tx, member.id, { spendId: id });
    for (const st of await tx.personalPlanStep.findMany({ where: { memberId: member.id, templateKind: "spend", templateId: id }, select: { id: true } })) await removeContributions(tx, member.id, { planStepId: st.id });
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
  const card = await prisma.financeAccount.findUnique({ where: { id: cardAccountId }, select: { memberId: true, type: true, name: true } });
  if (!card || card.memberId !== member.id || card.type !== "credit_card") { log.warn("markCardBillPaid", "blocked", { outcome: "blocked", reason: "not-owner", ...ctx }); return; }
  const cycleEnd = new Date(cycleEndISO);
  if (isNaN(cycleEnd.getTime())) { log.warn("markCardBillPaid", "blocked", { outcome: "blocked", reason: "bad-date", ...ctx }); return; }
  // The payment leaves cash in the CURRENT open personal month.
  const period = await ensurePersonalMonth(member.id);
  // Paid less than the tagged total → the difference is a saving/cashback on that card.
  // Record it as a cashback transaction (marked by category so undo can reverse it).
  const cashbackMarker = `__billcashback__:${cycleEnd.toISOString()}`;
  const billpayMarker = `__billpay__:${cycleEnd.toISOString()}`;
  const cashback = cycleTotal && cycleTotal > amount ? Math.round((cycleTotal - amount) * 100) / 100 : 0;
  // Optionally pay the bill FROM one of the member's balance accounts → a transfer_out that drops its
  // balance (tagged by billpayMarker so unmarking reverses it). null = just settle the cycle (as before).
  const rawFrom = Number(formData.get("fromAccountId")) || 0;
  let payFromId: number | null = null;
  if (rawFrom) {
    const acc = await prisma.financeAccount.findFirst({ where: { id: rawFrom, memberId: member.id, active: true }, select: { id: true, type: true } });
    if (acc && BALANCE_ACCOUNT_TYPES.has(acc.type)) payFromId = acc.id;
  }
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
        data: { memberId: member.id, accountId: cardAccountId, date: new Date(), merchant: "Bill savings / cashback", amount: cashback, type: "cashback", category: cashbackMarker, source: "manual" },
      });
    }
    // replace any prior bill-payment decrement for this cycle, then (if paying from an account) post it
    await tx.accountTransaction.deleteMany({ where: { memberId: member.id, category: billpayMarker } });
    if (payFromId) {
      await tx.accountTransaction.create({
        data: { memberId: member.id, accountId: payFromId, date: new Date(), merchant: `Paid ${card.name} bill`, amount, type: "transfer_out", category: billpayMarker, source: "manual" },
      });
    }
  });
  log.info("markCardBillPaid", "ok", { outcome: "ok", ...ctx, amount, cashback });
  // Record it in the household audit trail so the payment shows in the Money Plan activity feed (entity
  // "cardbill") — logged against the open family month, since that's the plan the payment settles.
  const famPeriod = await prisma.period.findFirst({ where: { householdId: member.householdId, status: "open" }, orderBy: [{ year: "desc" }, { month: "desc" }], select: { id: true } });
  await recordActivity({ householdId: member.householdId, memberId: member.id, memberName: member.name, entity: "cardbill", action: "created", summary: `Paid ${card.name} bill ${formatINR(amount)}`, periodId: famPeriod?.id ?? null });
  rev();
  // A card cycle can carry a FAMILY portion that sits in the family In-Hand as "held for the bill"
  // (getInHand → pendingCardHeld). Marking it paid must bust the family cache too, or the family view
  // keeps showing the bill as still-held and the In-Hand won't drop. Over-invalidation is safe.
  revalidateFamily();
}

export async function unmarkCardBillPaid(formData: FormData) {
  const member = await me("unmarkCardBillPaid");
  if (!member) return;
  const id = Number(formData.get("id"));
  const bill = await prisma.personalCardBill.findUnique({ where: { id }, include: { cardAccount: { select: { name: true } } } });
  if (!bill || bill.memberId !== member.id) { log.warn("unmarkCardBillPaid", "blocked", { outcome: "blocked", reason: "not-owner", memberId: member.id, id }); return; }
  const cashbackMarker = `__billcashback__:${bill.cycleEnd.toISOString()}`;
  const billpayMarker = `__billpay__:${bill.cycleEnd.toISOString()}`;
  await prisma.$transaction([
    prisma.accountTransaction.deleteMany({ where: { accountId: bill.cardAccountId, category: cashbackMarker } }),
    prisma.accountTransaction.deleteMany({ where: { memberId: member.id, category: billpayMarker } }),
    prisma.personalCardBill.delete({ where: { id } }),
  ]);
  log.info("unmarkCardBillPaid", "ok", { outcome: "ok", memberId: member.id, id });
  const famPeriod = await prisma.period.findFirst({ where: { householdId: member.householdId, status: "open" }, orderBy: [{ year: "desc" }, { month: "desc" }], select: { id: true } });
  await recordActivity({ householdId: member.householdId, memberId: member.id, memberName: member.name, entity: "cardbill", action: "deleted", summary: `Undid ${bill.cardAccount?.name ?? "card"} bill payment ${formatINR(bill.amount)}`, periodId: famPeriod?.id ?? null });
  rev();
  revalidateFamily(); // family In-Hand holds the bill's family portion again → bust the family cache
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
    await prisma.$transaction(async (tx) => {
      const a = await tx.personalLoan.create({ data: { memberId: member.id, direction, counterparty: cpMember.name, ...common } });
      const b = await tx.personalLoan.create({ data: { memberId: cpMember.id, direction: opp, counterparty: member.name, ...common } });
      await postLoanMoney(tx, [a, b], amount, "create"); // the money leaves the lender's account, lands in the borrower's
    });
  } else {
    const counterparty = String(formData.get("counterparty") ?? "").trim();
    if (!counterparty) return;
    await prisma.$transaction(async (tx) => {
      const a = await tx.personalLoan.create({ data: { memberId: member.id, direction, counterparty, amount, outstanding: amount, note, dueDate, notifyDaysBefore } });
      await postLoanMoney(tx, [a], amount, "create");
    });
  }
  rev();
}

// Money in/out on a lending entry moves each side's PERSONAL account: the lender's goes up when repaid (down
// when lending), the borrower's the other way. One marked line per row + event, so it's traceable.
const LOAN_MARK = (loanId: number) => `__loan__:${loanId}`;
async function postLoanMoney(
  tx: Prisma.TransactionClient,
  rows: { id: number; memberId: number; direction: string; counterparty: string; note: string | null }[],
  amount: number, event: "repay" | "create",
) {
  if (amount <= 0.005) return;
  for (const r of rows) {
    const acct = await personalAccountIdOf(tx, r.memberId);
    if (acct == null) continue;
    // repay: lender receives (in), borrower pays (out) · create: lender pays out, borrower receives
    const incoming = event === "repay" ? r.direction === "lent" : r.direction === "borrowed";
    const what = r.note ? ` · ${r.note}` : "";
    await tx.accountTransaction.create({
      data: {
        memberId: r.memberId, accountId: acct, date: new Date(), amount: Math.round(amount * 100) / 100,
        type: incoming ? "transfer_in" : "transfer_out",
        merchant: event === "repay" ? (incoming ? `From ${r.counterparty}${what}` : `To ${r.counterparty}${what}`) : (incoming ? `Borrowed from ${r.counterparty}${what}` : `Lent to ${r.counterparty}${what}`),
        category: event === "create" ? LOAN_MARK(r.id) : `${LOAN_MARK(r.id)}:paid`, source: "manual",
      },
    });
  }
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

export async function recordPersonalLoanPayment(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const pay = parseAmount(formData.get("amount"));
  const loan = await prisma.personalLoan.findUnique({ where: { id } });
  if (!loan || loan.memberId !== member.id || !pay || pay <= 0) return;
  const outstanding = Math.max(0, loan.outstanding - pay);
  const moved = Math.min(pay, loan.outstanding);
  // Lending never moves "Can spend" (it isn't budget) — it moves real money: the repayment lands in the
  // lender's personal account and leaves the borrower's (both sides of a linked pair).
  await prisma.$transaction(async (tx) => {
    const rows = await tx.personalLoan.findMany({ where: loanGroupWhere(loan), select: { id: true, memberId: true, direction: true, counterparty: true, note: true } });
    await tx.personalLoan.updateMany({ where: loanGroupWhere(loan), data: { outstanding, status: outstanding <= 0.005 ? "settled" : "open" } });
    await postLoanMoney(tx, rows, moved, "repay");
  });
  rev();
}

export async function settlePersonalLoan(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const loan = await prisma.personalLoan.findUnique({ where: { id } });
  if (!loan || loan.memberId !== member.id) return;
  // Clears the whole debt: what was still outstanding moves between the two personal accounts — no spend.
  await prisma.$transaction(async (tx) => {
    const rows = await tx.personalLoan.findMany({ where: loanGroupWhere(loan), select: { id: true, memberId: true, direction: true, counterparty: true, note: true } });
    await tx.personalLoan.updateMany({ where: loanGroupWhere(loan), data: { outstanding: 0, status: "settled" } });
    await postLoanMoney(tx, rows, loan.outstanding, "repay");
  });
  rev();
}

export async function deletePersonalLoan(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const loan = await prisma.personalLoan.findUnique({ where: { id } });
  if (!loan || loan.memberId !== member.id) return;
  await prisma.$transaction(async (tx) => {
    if (loan.spendId != null) {
      // This debt came from splitting/reimbursing a spend (or a peer-card use). Deleting it is two-way:
      // wipe the WHOLE set — every loan row tied to that spend (both members' sides) + the parent spend
      // itself, which cascades its card-ledger line. Delete the loans first, then the spend.
      await tx.personalLoan.deleteMany({ where: { spendId: loan.spendId } });
      await tx.personalSpend.deleteMany({ where: { id: loan.spendId } });
    } else {
      // A manual lend/borrow with no parent spend → just clear it (and its linked mirror, via linkGroup), and
      // undo the money its creation moved (a mistaken entry). Repayments already made stay — they happened.
      // Only for an untouched entry: once anything was repaid, both legs really happened — keep them.
      if (loan.status === "open" && Math.abs(loan.outstanding - loan.amount) < 0.005) {
        const rows = await tx.personalLoan.findMany({ where: loanGroupWhere(loan), select: { id: true } });
        await tx.accountTransaction.deleteMany({ where: { category: { in: rows.map((r) => LOAN_MARK(r.id)) } } });
      }
      await tx.personalLoan.deleteMany({ where: loanGroupWhere(loan) });
    }
  });
  rev();
}

// Edit a "You lent" entry: amount, collect-by date, note, reminder lead — NOT the counterparty. Amount +
// date are locked for a card-fronted debt (the peer card cycle drives those). When it's a shared-spend
// receivable, changing its amount rebalances the PARENT spend (others' owed = Σ shares, your share is the
// residual) — so the spend and the lending entry stay in sync both ways. Applies to the whole linked
// group, so the mirror on the other member's tab tracks the change too.
export async function updatePersonalLoan(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const loan = await prisma.personalLoan.findUnique({ where: { id } });
  if (!loan || loan.memberId !== member.id || loan.direction !== "lent") return;
  const r2 = (x: number) => Math.round(x * 100) / 100;

  const note = String(formData.get("note") ?? "").trim() || null;
  const nd = Number(formData.get("notifyDaysBefore"));
  const notifyDaysBefore = Number.isFinite(nd) && nd >= 0 ? Math.round(nd) : loan.notifyDaysBefore;
  const editable = loan.cardAccountId == null; // peer-card amount/date are immutable (driven by the card)
  const newAmount = editable ? (parseAmount(formData.get("amount")) || loan.amount) : loan.amount;
  if (!newAmount || newAmount <= 0) return;
  const dueRaw = String(formData.get("dueDate") ?? "").trim();
  const dueDate = !editable ? loan.dueDate : dueRaw ? new Date(`${dueRaw}T00:00:00`) : null;
  const paid = Math.max(0, r2(loan.amount - loan.outstanding)); // preserve what's already been paid
  const newOutstanding = Math.max(0, r2(newAmount - paid));

  if (loan.spendId && editable && Math.abs(newAmount - loan.amount) > 0.005) {
    const spend = await prisma.personalSpend.findUnique({ where: { id: loan.spendId }, select: { id: true, amount: true } });
    if (spend) {
      const others = await prisma.personalLoan.aggregate({ where: { spendId: spend.id, direction: "lent", id: { not: id } }, _sum: { amount: true } });
      const newSharedOthers = r2((others._sum.amount ?? 0) + newAmount);
      if (newSharedOthers > spend.amount + 0.005) throw new Error("owed exceeds the spend");
      await prisma.personalSpend.update({ where: { id: spend.id }, data: { sharedOthers: newSharedOthers } });
      await prisma.personalLoan.updateMany({ where: { spendId: spend.id, direction: "lent" }, data: { sharedShare: r2(spend.amount - newSharedOthers), sharedPaid: spend.amount } });
    }
  }

  await prisma.personalLoan.updateMany({
    where: loanGroupWhere(loan),
    data: { amount: newAmount, outstanding: newOutstanding, note, dueDate, notifyDaysBefore, status: newOutstanding <= 0.005 ? "settled" : "open" },
  });
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

// ── Money-Plan steps (the executable monthly choreography) ──────────────────────────────────────
// Steps are materialised from templates by ensurePlanSteps (lib/personal/planSteps.ts): Setup's recurring
// income / bills / spends / transfers / saves, plus credit-card bills due this month. Per month the member
// can edit, remove, reorder, insert and tick them. Ticking performs the real money movement, unticking
// reverses it exactly. Edits are MONTH-ONLY: a template-derived row's original Setup values are kept on the
// step's snapshot (next month clones those), and "remove" just leaves the month's budget. See PersonalPlanStep.

type PlanStepRow = {
  id: number; kind: string; status: string; amount: number; label: string;
  templateKind: string | null; templateId: number | null; fromAccountId: number | null; toAccountId: number | null;
  transferOutId: number | null; transferInId: number | null; savingsId: number | null;
  snapshot?: Prisma.JsonValue | null;
  holdingId?: number | null; // ticking adds a contribution to this net-worth holding
};

const PLAN_METHODS = new Set(["upi", "cash", "card", "other"]);
const STEP_MARK = (stepId: number) => `__planstep__:${stepId}`;
const clampDay = (raw: FormDataEntryValue | null): number | null =>
  raw == null || String(raw).trim() === "" ? null : Math.min(28, Math.max(1, Math.round(Number(raw))));

// Resolve a form field to one of the member's OWN active balance accounts (bank/cash/debit/prepaid), or null.
async function ownBalanceAccountId(memberId: number, raw: FormDataEntryValue | null): Promise<number | null> {
  const id = Number(raw);
  if (!id) return null;
  const a = await prisma.financeAccount.findFirst({ where: { id, memberId, active: true }, select: { id: true, type: true } });
  return a && BALANCE_ACCOUNT_TYPES.has(a.type) ? a.id : null;
}

// Resolve a form field to ANY of the member's own active accounts (bank, cash, debit/prepaid/credit card).
async function ownAccount(memberId: number, raw: FormDataEntryValue | null): Promise<{ id: number; type: string } | null> {
  const id = Number(raw);
  if (!id) return null;
  return prisma.financeAccount.findFirst({ where: { id, memberId, active: true }, select: { id: true, type: true } });
}

// Is this bill/spend step's underlying row a one-off added in the plan (not a Setup recurring template)?
async function isOneOffRow(tx: Prisma.TransactionClient, memberId: number, step: PlanStepRow): Promise<boolean> {
  if (step.templateKind == null) return true;
  if (!step.templateId) return false;
  if (step.kind === "expense") return !!(await tx.personalExpense.findFirst({ where: { id: step.templateId, memberId, recurring: false }, select: { id: true } }));
  if (step.kind === "spend") return !!(await tx.personalSpend.findFirst({ where: { id: step.templateId, memberId, recurring: false }, select: { id: true } }));
  return false;
}

// A step's `snapshot` {edited: true} marks "the member touched this step this month" (informational; Setup no
// longer syncs into a month, so nothing overwrites it either way).
const EDIT_MARK = { edited: true } as const;
async function markEdited(tx: Prisma.TransactionClient, stepId: number) {
  const cur = await tx.personalPlanStep.findUnique({ where: { id: stepId }, select: { snapshot: true } });
  if (cur?.snapshot == null) await tx.personalPlanStep.update({ where: { id: stepId }, data: { snapshot: EDIT_MARK } });
}

// Rewrite the income / bill / spend ROW behind a step — THIS month's own line only. Setup lives in
// PersonalTemplate, so a month edit can never leak into it (no snapshot bookkeeping needed any more).
async function editStepRow(
  tx: Prisma.TransactionClient, memberId: number, step: PlanStepRow,
  patch: { label?: string; amount?: number; cardAccountId?: number | null; payAccountId?: number | null; accountId?: number | null },
) {
  if (!step.templateId) return;
  if (step.kind === "expense") {
    await tx.personalExpense.updateMany({ where: { id: step.templateId, memberId }, data: { ...(patch.label !== undefined ? { label: patch.label } : {}), ...(patch.amount !== undefined ? { amount: patch.amount } : {}), ...(patch.cardAccountId !== undefined ? { cardAccountId: patch.cardAccountId } : {}), ...(patch.payAccountId !== undefined ? { payAccountId: patch.payAccountId } : {}) } });
  } else if (step.kind === "spend") {
    await tx.personalSpend.updateMany({ where: { id: step.templateId, memberId }, data: { ...(patch.label !== undefined ? { note: patch.label } : {}), ...(patch.amount !== undefined ? { amount: patch.amount } : {}), ...(patch.cardAccountId !== undefined ? { cardAccountId: patch.cardAccountId } : {}), ...(patch.payAccountId !== undefined ? { payAccountId: patch.payAccountId } : {}) } });
  } else if (step.kind === "income" && step.templateKind === "income") {
    await tx.personalIncome.updateMany({ where: { id: step.templateId, memberId }, data: { ...(patch.label !== undefined ? { source: patch.label } : {}), ...(patch.amount !== undefined ? { amount: patch.amount } : {}), ...(patch.accountId !== undefined ? { accountId: patch.accountId } : {}) } });
  }
}

// Set HOW a step moves and WHICH accounts it runs between (sender = from, receiver = to), applying the
// account to the underlying row where the ledger/budget reads it. Returns an error message, or null.
//  • transfer: two own balance accounts · income: receiver is a balance account · bill/spend: sender is any
//    own account — a card sender goes on the row's cardAccountId (card-deferred accounting), a bank/cash
//    sender is posted at tick · save: optional sender.
async function applyStepRoute(
  tx: Prisma.TransactionClient, memberId: number, step: PlanStepRow,
  input: { method: string | null; fromRaw: FormDataEntryValue | null; toRaw: FormDataEntryValue | null },
): Promise<string | null> {
  const lookup = async (raw: FormDataEntryValue | null) => {
    const id = Number(raw);
    if (!id) return null;
    return tx.financeAccount.findFirst({ where: { id, memberId, active: true }, select: { id: true, type: true } });
  };
  const from = await lookup(input.fromRaw);
  const to = await lookup(input.toRaw);
  let fromId: number | null = from?.id ?? null;
  let toId: number | null = to?.id ?? null;
  if (step.kind === "transfer") {
    if (from && !BALANCE_ACCOUNT_TYPES.has(from.type)) return "A transfer's sender must be a bank, cash or wallet account.";
    if (to && !BALANCE_ACCOUNT_TYPES.has(to.type)) return "A transfer's receiver must be a bank, cash or wallet account.";
    if (fromId && toId && fromId === toId) return "Pick two different accounts.";
  } else if (step.kind === "income") {
    fromId = null;
    if (to && !BALANCE_ACCOUNT_TYPES.has(to.type)) return "Income can only be received into a bank, cash or wallet account.";
  } else {
    toId = null; // save / bill / spend: the receiver is the savings pot / the biller, not one of your accounts
  }
  await tx.personalPlanStep.update({ where: { id: step.id }, data: { method: input.method, fromAccountId: fromId, toAccountId: toId } });
  if (step.kind === "expense" || step.kind === "spend") {
    const isCard = from != null && from.type !== "bank" && from.type !== "cash"; // credit / debit / prepaid card
    await editStepRow(tx, memberId, step, { cardAccountId: isCard ? from!.id : null, payAccountId: from != null && !isCard ? from.id : null });
  } else if (step.kind === "income" && step.templateKind === "income") {
    await editStepRow(tx, memberId, step, { accountId: toId });
  }
  return null;
}

// Place `stepId` right after `afterId` (null = top, undefined = leave where derived) and renumber every step
// of the month, so the manual order is one consistent sequence.
async function renumberSteps(tx: Prisma.TransactionClient, periodId: number, moved?: { stepId: number; afterId: number | null }) {
  const all = await tx.personalPlanStep.findMany({ where: { periodId }, select: { id: true, kind: true, dayOfMonth: true, sortOrder: true, position: true } });
  let ordered = orderSteps(all).map((s) => s.id);
  if (moved) {
    ordered = ordered.filter((id) => id !== moved.stepId);
    const at = moved.afterId == null ? 0 : ordered.indexOf(moved.afterId) + 1;
    ordered.splice(at < 0 ? ordered.length : at, 0, moved.stepId);
  }
  await Promise.all(ordered.map((id, idx) => tx.personalPlanStep.update({ where: { id }, data: { position: idx } })));
}

// Undo a done step's ledger effect (shared by untick + deleting a done one-off). Leaves the step row alone.
async function reversePlanStepEffect(tx: Prisma.TransactionClient, step: PlanStepRow, memberId: number) {
  await removeContributions(tx, memberId, { planStepId: step.id }); // a holding contribution it made (if any)
  if (step.kind === "income") {
    if (step.templateKind === "baseincome") {
      if (step.templateId) await tx.accountTransaction.deleteMany({ where: { memberId, category: `__baseincome__:${step.templateId}` } });
    } else if (step.templateId) {
      await tx.accountTransaction.deleteMany({ where: { personalIncomeId: step.templateId } });
      // keep the income row's accountId (the target) so it persists across untick + next month's seeding.
    }
  } else if (step.kind === "transfer") {
    const ids = [step.transferOutId, step.transferInId].filter((x): x is number => x != null);
    if (ids.length) await tx.accountTransaction.deleteMany({ where: { id: { in: ids }, memberId } });
  } else if (step.kind === "save") {
    if (step.savingsId) await tx.personalSavings.deleteMany({ where: { id: step.savingsId, memberId } });
    await tx.accountTransaction.deleteMany({ where: { memberId, category: STEP_MARK(step.id) } }); // its account debit
  } else if (step.kind === "expense") {
    if (step.templateId) await tx.personalExpense.updateMany({ where: { id: step.templateId, memberId }, data: { pending: true } });
    await tx.accountTransaction.deleteMany({ where: { memberId, category: STEP_MARK(step.id) } });
  } else if (step.kind === "spend") {
    await tx.accountTransaction.deleteMany({ where: { memberId, category: STEP_MARK(step.id) } });
    if (step.templateId) {
      await tx.personalSpend.updateMany({ where: { id: step.templateId, memberId }, data: { pending: true } });
      await tx.accountTransaction.deleteMany({ where: { personalSpendId: step.templateId } });
    }
  }
}

// A bill/spend paid from a bank or cash account (not a card — card rows post their own mirror): debit that
// account with a step-marked ledger line so the balance moves; untick deletes it by the marker.
async function postStepOutflow(tx: Prisma.TransactionClient, memberId: number, step: PlanStepRow, date: Date, amount: number) {
  if (!step.fromAccountId) return;
  const from = await tx.financeAccount.findFirst({ where: { id: step.fromAccountId, memberId, active: true }, select: { id: true, type: true } });
  if (!from || (from.type !== "bank" && from.type !== "cash")) return;
  await tx.accountTransaction.deleteMany({ where: { memberId, category: STEP_MARK(step.id) } });
  await tx.accountTransaction.create({ data: { memberId, accountId: from.id, date, merchant: step.label, amount, type: "spend", category: STEP_MARK(step.id), source: "manual" } });
}

// Mark a step paid / received / done. The optional method + fromAccountId + toAccountId fields (from the
// "which account?" modal shown when a step has none yet) are applied first, so the money moves from/to the
// account the member just picked. Card-bill steps are paid through payCardBillStep instead.
export async function tickPlanStep(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const found = await prisma.personalPlanStep.findFirst({ where: { id, memberId: member.id } });
  if (!found || found.status === "done" || found.kind === "cardbill") return;
  const date = new Date();
  let routeError: string | null = null;
  await prisma.$transaction(async (tx) => {
    let step: PlanStepRow = found;
    if (formData.has("fromAccountId") || formData.has("toAccountId") || formData.has("method")) {
      const m = String(formData.get("method") ?? "");
      routeError = await applyStepRoute(tx, member.id, found, { method: PLAN_METHODS.has(m) ? m : null, fromRaw: formData.get("fromAccountId"), toRaw: formData.get("toAccountId") });
      if (routeError) return;
      const fresh = await tx.personalPlanStep.findUnique({ where: { id: found.id } });
      if (fresh) step = fresh;
    }
    const amt = Math.round(step.amount * 100) / 100;
    if (step.kind === "income") {
      if (step.templateKind === "baseincome") {
        // Legacy base salary received → credit the account with the CURRENT period income (marker-tagged, reversible).
        if (step.templateId) {
          const period = await tx.personalPeriod.findFirst({ where: { id: step.templateId, memberId: member.id }, select: { income: true, incomeAccountId: true } });
          const acctId = period?.incomeAccountId ?? step.toAccountId;
          if (period && period.income > 0 && acctId) {
            const marker = `__baseincome__:${step.templateId}`;
            await tx.accountTransaction.deleteMany({ where: { memberId: member.id, category: marker } });
            await tx.accountTransaction.create({ data: { memberId: member.id, accountId: acctId, date, merchant: "Salary", amount: Math.round(period.income * 100) / 100, type: "topup", category: marker, source: "manual" } });
          }
        }
      } else if (step.templateId && step.toAccountId) {
        // Income row → credit the target account (mirror ledger line keyed by the income row).
        const income = await tx.personalIncome.findFirst({ where: { id: step.templateId, memberId: member.id } });
        const acct = await tx.financeAccount.findFirst({ where: { id: step.toAccountId, memberId: member.id, active: true }, select: { id: true, type: true } });
        if (income && acct && BALANCE_ACCOUNT_TYPES.has(acct.type)) {
          await tx.personalIncome.update({ where: { id: income.id }, data: { accountId: acct.id } });
          await syncPersonalIncomeLedger(tx, { incomeId: income.id, memberId: member.id, accountId: acct.id, amount: income.amount, source: income.source, date: income.date });
        }
      }
      await tx.personalPlanStep.update({ where: { id: step.id }, data: { status: "done", doneAt: date } });
    } else if (step.kind === "transfer") {
      if (!step.fromAccountId || !step.toAccountId) { routeError = "Pick the sender and receiver account first."; return; }
      const [from, to] = await Promise.all([
        tx.financeAccount.findFirst({ where: { id: step.fromAccountId, memberId: member.id }, select: { id: true, name: true, type: true } }),
        tx.financeAccount.findFirst({ where: { id: step.toAccountId, memberId: member.id }, select: { id: true, name: true, type: true } }),
      ]);
      if (!from || !to || !BALANCE_ACCOUNT_TYPES.has(from.type) || !BALANCE_ACCOUNT_TYPES.has(to.type)) { routeError = "Both accounts must be bank, cash or wallet accounts."; return; }
      const out = await tx.accountTransaction.create({ data: { memberId: member.id, accountId: from.id, date, merchant: step.label || `Transfer → ${to.name}`, amount: amt, type: "transfer_out", source: "manual" } });
      const inn = await tx.accountTransaction.create({ data: { memberId: member.id, accountId: to.id, date, merchant: step.label || `Transfer ← ${from.name}`, amount: amt, type: "transfer_in", source: "manual" } });
      await tx.personalPlanStep.update({ where: { id: step.id }, data: { status: "done", doneAt: date, transferOutId: out.id, transferInId: inn.id } });
    } else if (step.kind === "save") {
      const dep = await tx.personalSavings.create({ data: { memberId: member.id, amount: amt, note: step.label || "Recurring saving" } });
      await postStepOutflow(tx, member.id, step, date, amt); // the money leaves the account it's saved from
      await tx.personalPlanStep.update({ where: { id: step.id }, data: { status: "done", doneAt: date, savingsId: dep.id } });
      if (step.holdingId) await addContribution(tx, { memberId: member.id, itemId: step.holdingId, amount: amt, date, note: step.label, planStepId: step.id });
    } else if (step.kind === "expense") {
      // Bill paid → the row is no longer "planned" (it already counted in the budget); debit the account.
      if (step.templateId) await tx.personalExpense.updateMany({ where: { id: step.templateId, memberId: member.id }, data: { pending: false } });
      await postStepOutflow(tx, member.id, step, date, amt);
      await tx.personalPlanStep.update({ where: { id: step.id }, data: { status: "done", doneAt: date } });
      // An investment bill (Invest category, linked to a holding) adds to that holding's history + value.
      const holdingId = step.holdingId ?? (step.templateId ? (await tx.personalExpense.findFirst({ where: { id: step.templateId, memberId: member.id }, select: { holdingId: true } }))?.holdingId : null);
      if (holdingId) await addContribution(tx, { memberId: member.id, itemId: holdingId, amount: amt, date, note: step.label, planStepId: step.id });
    } else if (step.kind === "spend") {
      // Spend paid → it becomes a real logged spend (moves from "planned" to "spent", Can-spend unchanged); if
      // on a card/balance account post the card ledger mirror, otherwise debit the chosen bank/cash account.
      if (step.templateId) {
        const spend = await tx.personalSpend.findFirst({ where: { id: step.templateId, memberId: member.id } });
        if (spend) {
          await tx.personalSpend.update({ where: { id: spend.id }, data: { pending: false } });
          const holdingId = step.holdingId ?? spend.holdingId;
          if (holdingId) await addContribution(tx, { memberId: member.id, itemId: holdingId, amount: spend.amount, date, note: step.label, planStepId: step.id });
          if (spend.cardAccountId) {
            await tx.accountTransaction.upsert({
              where: { personalSpendId: spend.id },
              update: { amount: spend.amount, merchant: step.label, accountId: spend.cardAccountId },
              create: { memberId: member.id, accountId: spend.cardAccountId, date, merchant: step.label, amount: spend.amount, type: "spend", category: null, source: "personal", personalSpendId: spend.id },
            });
          } else {
            await postStepOutflow(tx, member.id, step, date, Math.round(spend.amount * 100) / 100);
          }
        }
      }
      await tx.personalPlanStep.update({ where: { id: step.id }, data: { status: "done", doneAt: date } });
    }
  });
  if (routeError) log.warn("tickPlanStep", "blocked", { outcome: "blocked", reason: routeError, memberId: member.id, id });
  rev();
  if (found.kind === "transfer") revalidateFamily(); // may move the family account (a card-bill share)
}

// Un-mark a done step: reverses its ledger effect exactly. A card-bill step also un-settles the card cycle
// (the family In-Hand holds its family portion again) and returns the personal-account debit.
export async function untickPlanStep(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const step = await prisma.personalPlanStep.findFirst({ where: { id, memberId: member.id } });
  if (!step || step.status !== "done") return;
  if (step.kind === "cardbill" && step.templateId) {
    const { cardId, cycleEnd } = decodeCardBillTemplateId(step.templateId);
    const bill = await prisma.personalCardBill.findFirst({ where: { cardAccountId: cardId, memberId: member.id, cycleEnd: { gte: new Date(cycleEnd.getTime() - 43200000), lte: new Date(cycleEnd.getTime() + 43200000) } }, select: { cycleEnd: true } });
    if (bill) {
      const fd = new FormData();
      fd.set("cardId", String(cardId));
      fd.set("cycleEnd", bill.cycleEnd.toISOString());
      await unpayFamilyCardBill(fd);
    }
    await prisma.$transaction(async (tx) => {
      if (step.transferOutId) await tx.accountTransaction.deleteMany({ where: { id: step.transferOutId, memberId: member.id } });
      // The transfer steps this payment created go with it (and the money they moved, if ticked).
      const funding = await tx.personalPlanStep.findMany({ where: { memberId: member.id, periodId: step.periodId, snapshot: { path: ["fundsCardBillStep"], equals: step.id } }, select: { id: true, transferOutId: true, transferInId: true } });
      const legIds = funding.flatMap((f) => [f.transferOutId, f.transferInId]).filter((x): x is number => x != null);
      if (legIds.length) await tx.accountTransaction.deleteMany({ where: { id: { in: legIds }, memberId: member.id } });
      if (funding.length) await tx.personalPlanStep.deleteMany({ where: { id: { in: funding.map((f) => f.id) } } });
      await tx.personalPlanStep.update({ where: { id: step.id }, data: { status: "pending", doneAt: null, transferOutId: null } });
    });
    rev();
    revalidateFamily();
    return;
  }
  await prisma.$transaction(async (tx) => {
    await reversePlanStepEffect(tx, step, member.id);
    await tx.personalPlanStep.update({ where: { id: step.id }, data: { status: "pending", doneAt: null, transferOutId: null, transferInId: null, savingsId: null } });
  });
  rev();
  if (step.kind === "transfer") revalidateFamily();
}

// ── Planned recurring spends live in the SPENDS tab ──────────────────────────────────────────────
// Setup's recurring spends are copied into each month as planned entries (pending). They are not Money-Plan
// steps: marking one paid HERE is what turns it into a real spend and lowers Can-spend. Paid from a bank/cash
// account → that account is debited (a marker-tagged line, removed again if the spend is deleted); on a card →
// the card ledger mirror, like any card spend; Cash/UPI with no account → nothing posts.
const SPEND_PAY_MARK = (spendId: number) => `__spendpay__:${spendId}`;

export async function payPlannedSpend(formData: FormData) {
  const member = await me();
  if (!member) return;
  const spendId = Number(formData.get("spendId"));
  const spend = await prisma.personalSpend.findFirst({ where: { id: spendId, memberId: member.id, pending: true } });
  if (!spend) return;
  let cardAccountId = spend.cardAccountId;
  let payAccountId = spend.payAccountId;
  if (formData.has("fromAccountId")) {
    // The account picked in the "how did you pay?" prompt (blank = Cash/UPI, no account).
    const a = await ownAccount(member.id, formData.get("fromAccountId"));
    const isCard = a != null && a.type !== "bank" && a.type !== "cash";
    cardAccountId = isCard ? a!.id : null;
    payAccountId = a != null && !isCard ? a.id : null;
  }
  const date = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.personalSpend.update({ where: { id: spend.id }, data: { pending: false, cardAccountId, payAccountId } });
    const label = spend.note?.trim() || "Spend";
    if (spend.holdingId) await addContribution(tx, { memberId: member.id, itemId: spend.holdingId, amount: spend.amount, date, note: label, spendId: spend.id });
    if (cardAccountId) {
      await tx.accountTransaction.upsert({
        where: { personalSpendId: spend.id },
        update: { amount: spend.amount, merchant: label, accountId: cardAccountId },
        create: { memberId: member.id, accountId: cardAccountId, date, merchant: label, amount: spend.amount, type: "spend", category: null, source: "personal", personalSpendId: spend.id },
      });
    } else {
      // A bank/cash account picked → that one; none (UPI) → the personal account.
      const payId = payAccountId ?? (await personalAccountIdOf(tx, member.id));
      const acct = payId ? await tx.financeAccount.findFirst({ where: { id: payId, memberId: member.id, active: true }, select: { id: true, type: true } }) : null;
      if (acct && BALANCE_ACCOUNT_TYPES.has(acct.type)) {
        await tx.accountTransaction.deleteMany({ where: { memberId: member.id, category: SPEND_PAY_MARK(spend.id) } });
        await tx.accountTransaction.create({ data: { memberId: member.id, accountId: acct.id, date, merchant: label, amount: Math.round(spend.amount * 100) / 100, type: "spend", category: SPEND_PAY_MARK(spend.id), source: "manual" } });
      }
    }
  });
  rev();
}

// Take a planned recurring spend out of THIS month only (Setup keeps it, next month it returns). A hidden
// "skipped" marker records it; Restore deletes the marker.
export async function removePlannedSpend(formData: FormData) {
  const member = await me();
  if (!member) return;
  const spendId = Number(formData.get("spendId"));
  const spend = await prisma.personalSpend.findFirst({ where: { id: spendId, memberId: member.id, pending: true }, select: { id: true, periodId: true, note: true, amount: true } });
  if (!spend) return;
  const existing = await prisma.personalPlanStep.findFirst({ where: { memberId: member.id, periodId: spend.periodId, templateKind: "spend", templateId: spend.id }, select: { id: true } });
  if (existing) await prisma.personalPlanStep.update({ where: { id: existing.id }, data: { status: "skipped" } });
  else await prisma.personalPlanStep.create({ data: { memberId: member.id, periodId: spend.periodId, kind: "spend", label: spend.note?.trim() || "Spend", amount: spend.amount, templateKind: "spend", templateId: spend.id, status: "skipped" } });
  rev();
}

export async function restorePlannedSpend(formData: FormData) {
  const member = await me();
  if (!member) return;
  const spendId = Number(formData.get("spendId"));
  await prisma.personalPlanStep.deleteMany({ where: { memberId: member.id, kind: "spend", templateKind: "spend", templateId: spendId, status: "skipped" } });
  rev();
}

// Re-check the month's steps against THIS month's own lines (re-creates a missing step, refreshes a pending
// one). Setup is not consulted — Setup reaches a month only at its creation or via "Apply to this month".
export async function rebuildPlanSteps(formData: FormData) {
  const member = await me();
  if (!member) return;
  const periodId = Number(formData.get("periodId"));
  if (!(await ownsPeriod(member.id, periodId))) return;
  await ensurePlanSteps(member.id, periodId);
  rev();
}

// ── Clumped transfers ─────────────────────────────────────────────────────────────────────────────
// Several Setup transfers with the same sender, receiver and day — or several bills paid from the same account
// on the same day — are shown as ONE step ("HDFC → SBI ₹22,204")
// with their lines inside. Ticking / unticking / moving the clump acts on every line in it; each line still
// posts its own ledger pair (so the account history keeps "gold", "APY", "FD"…), and the balance moves by the sum.
const idList = (raw: FormDataEntryValue | null) => String(raw ?? "").split(",").map((x) => Number(x.trim())).filter((x) => x > 0);

export async function tickPlanStepGroup(formData: FormData) {
  for (const id of idList(formData.get("ids"))) {
    const fd = new FormData();
    fd.set("id", String(id));
    // A clump of bills with no account yet is paid through one "paid from?" prompt: apply it to every line.
    if (formData.has("fromAccountId")) {
      fd.set("fromAccountId", String(formData.get("fromAccountId") ?? ""));
      fd.set("method", String(formData.get("method") ?? ""));
    }
    await tickPlanStep(fd);
  }
}

export async function untickPlanStepGroup(formData: FormData) {
  for (const id of idList(formData.get("ids"))) {
    const fd = new FormData();
    fd.set("id", String(id));
    await untickPlanStep(fd);
  }
}

// Move a clump one place up or down: its lines travel together past the neighbouring visible step.
export async function movePlanStepGroup(formData: FormData) {
  const member = await me();
  if (!member) return;
  const ids = idList(formData.get("ids"));
  const dir = formData.get("dir") === "up" ? -1 : 1;
  if (ids.length === 0) return;
  const first = await prisma.personalPlanStep.findFirst({ where: { id: ids[0], memberId: member.id }, select: { periodId: true } });
  if (!first) return;
  await prisma.$transaction(async (tx) => {
    const all = await tx.personalPlanStep.findMany({ where: { periodId: first.periodId, memberId: member.id }, select: { id: true, kind: true, dayOfMonth: true, sortOrder: true, position: true, status: true } });
    const ordered = orderSteps(all);
    const inGroup = new Set(ids);
    const idxs = ordered.map((s, i) => (inGroup.has(s.id) ? i : -1)).filter((i) => i >= 0);
    if (idxs.length === 0) return;
    const visible = (s: (typeof ordered)[number]) => s.status !== "skipped" && !inGroup.has(s.id);
    // nearest visible, non-group neighbour on the side we're moving toward
    let n = -1;
    if (dir < 0) { for (let i = idxs[0] - 1; i >= 0; i--) if (visible(ordered[i])) { n = i; break; } }
    else { for (let i = idxs[idxs.length - 1] + 1; i < ordered.length; i++) if (visible(ordered[i])) { n = i; break; } }
    if (n < 0) return;
    const block = idxs.map((i) => ordered[i].id);
    const rest = ordered.filter((s) => !inGroup.has(s.id)).map((s) => s.id);
    const at = rest.indexOf(ordered[n].id);
    rest.splice(dir < 0 ? at : at + 1, 0, ...block);
    await Promise.all(rest.map((sid, idx) => tx.personalPlanStep.update({ where: { id: sid }, data: { position: idx } })));
  });
  rev();
}

// Pay a credit-card bill step. The cycle's total splits by WHO it is for: the family spends on the card
// (familyTotal — exactly the "held for this card" figure on the family In-Hand and the family spends shown
// on the card) are paid out of the family In-Hand, and the rest (your own spends + any annual fee + any ±
// difference to the real statement) leaves the PERSONAL account you pick. One settle record (PersonalCardBill)
// drives both views — payFamilyCardBill writes it, so the In-Hand hold drops in the same stroke.
export async function payCardBillStep(prev: PersonalSaveState, formData: FormData): Promise<PersonalSaveState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const id = Number(formData.get("id"));
  const step = await prisma.personalPlanStep.findFirst({ where: { id, memberId: member.id, kind: "cardbill" } });
  if (!step || !step.templateId) return { ok: false, error: "Step not found.", n };
  if (step.status === "done") return { ok: false, error: "Already paid.", n };
  const amount = parseAmount(formData.get("amount"));
  if (amount == null || amount < 0) return { ok: false, error: "Enter the amount you paid.", n };
  const { cardId } = decodeCardBillTemplateId(step.templateId);
  const dues = await getCardDues(member.id);
  const due = dues.find((d) => d.cardId === cardId);
  const cyc = due?.cycles.find((c) => cardBillTemplateId(cardId, new Date(c.cycleEndISO)) === step.templateId);
  if (!due || !cyc) return { ok: false, error: "This bill is no longer open — refresh the plan.", n };
  const family = Math.min(amount, Math.round(cyc.familyTotal * 100) / 100); // the family's share of what was paid
  const personalShare = Math.max(0, Math.round((amount - family) * 100) / 100); // yours
  const r2 = (x: number) => Math.round(x * 100) / 100;
  // The WHOLE bill leaves the one account you paid from. Each share whose money sits in a different account
  // (the family's in your family account, yours in your personal account) becomes a transfer step INTO the
  // paying account — so every balance ends right once they're done. A member with no accounts: nothing posts
  // (as if the money already moved).
  const balanceAccts = await prisma.financeAccount.count({ where: { memberId: member.id, active: true, type: { in: [...BALANCE_ACCOUNT_TYPES] } } });
  const payFrom = await ownAccount(member.id, formData.get("fromAccountId"));
  if (balanceAccts > 0 && !payFrom) return { ok: false, error: "Pick the account you paid it from.", n };
  if (payFrom && !BALANCE_ACCOUNT_TYPES.has(payFrom.type)) return { ok: false, error: "Pay from a bank, cash or wallet account.", n };
  const sourceOf = async (key: string) => {
    const a = await ownAccount(member.id, formData.get(key));
    return a && BALANCE_ACCOUNT_TYPES.has(a.type) ? a.id : null;
  };
  const familyFrom = family > 0.005 ? await sourceOf("familyFromId") : null;
  const personalFrom = personalShare > 0.005 ? await sourceOf("personalFromId") : null;
  const movedNow = formData.get("movedNow") === "on"; // "I've moved it already" → the transfer steps are created ticked

  const fd = new FormData();
  fd.set("cardId", String(cardId));
  fd.set("cycleEnd", cyc.cycleEndISO);
  fd.set("amount", String(amount));
  fd.set("skipBankDebit", "1"); // this step debits the account picked in its own modal
  const res = await payFamilyCardBill(fd);
  if (!res.ok) return { ok: false, error: ("error" in res && res.error) || "Couldn't record the payment.", n };

  const now = new Date();
  const day = Math.min(28, Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric" }).format(now)));
  await prisma.$transaction(async (tx) => {
    let outId: number | null = null;
    if (payFrom && amount > 0.004) {
      const t = await tx.accountTransaction.create({ data: { memberId: member.id, accountId: payFrom.id, date: now, merchant: `Paid ${due.cardName} bill`, amount: r2(amount), type: "transfer_out", category: `__billpay__:${cyc.cycleEndISO}`, source: "manual" } });
      outId = t.id;
    }
    await tx.personalPlanStep.update({ where: { id: step.id }, data: { status: "done", doneAt: now, fromAccountId: payFrom?.id ?? null, amount, transferOutId: outId } });
    if (!payFrom) return;
    const names = new Map((await tx.financeAccount.findMany({ where: { memberId: member.id }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
    for (const m of [
      { from: familyFrom, amt: family, what: "family share" },
      { from: personalFrom, amt: personalShare, what: "your share" },
    ]) {
      if (m.from == null || m.from === payFrom.id || m.amt <= 0.005) continue;
      const label = `${due.cardName} bill · ${m.what}`;
      const created = await tx.personalPlanStep.create({
        data: {
          memberId: member.id, periodId: step.periodId, kind: "transfer", label, amount: r2(m.amt), dayOfMonth: day,
          fromAccountId: m.from, toAccountId: payFrom.id, note: `${names.get(m.from) ?? "?"} → ${names.get(payFrom.id) ?? "?"}`,
          snapshot: { fundsCardBillStep: step.id }, // removed again if the bill payment is undone
        },
      });
      if (movedNow) {
        const o = await tx.accountTransaction.create({ data: { memberId: member.id, accountId: m.from, date: now, merchant: label, amount: r2(m.amt), type: "transfer_out", source: "manual" } });
        const i = await tx.accountTransaction.create({ data: { memberId: member.id, accountId: payFrom.id, date: now, merchant: label, amount: r2(m.amt), type: "transfer_in", source: "manual" } });
        await tx.personalPlanStep.update({ where: { id: created.id }, data: { status: "done", doneAt: now, transferOutId: o.id, transferInId: i.id } });
      }
    }
  });
  rev();
  revalidateFamily();
  return { ok: true, n };
}

// Set HOW a step moves and WHICH accounts it runs between. Allowed until it is done (untick to change a done one).
export async function setPlanStepRoute(prev: PersonalSaveState, formData: FormData): Promise<PersonalSaveState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const id = Number(formData.get("id"));
  const step = await prisma.personalPlanStep.findFirst({ where: { id, memberId: member.id } });
  if (!step) return { ok: false, error: "Step not found.", n };
  if (step.status === "done") return { ok: false, error: "Untick it first to change accounts.", n };
  if (step.kind === "cardbill") return { ok: false, error: "Choose the account when you pay this bill.", n };
  const m = String(formData.get("method") ?? "");
  let err: string | null = null;
  await prisma.$transaction(async (tx) => {
    err = await applyStepRoute(tx, member.id, step, { method: PLAN_METHODS.has(m) ? m : null, fromRaw: formData.get("fromAccountId"), toRaw: formData.get("toAccountId") });
    if (!err) await markEdited(tx, step.id);
  });
  if (err) return { ok: false, error: err, n };
  rev();
  return { ok: true, n };
}

// Edit a step's details for THIS month only: name, amount, day and note. Bills/spends/income rewrite their
// month row (original Setup values stay on the snapshot); transfers/saves are step-only. Not for done steps
// (untick first — its ledger lines were posted at the old amount) and not for card bills (amount is live).
export async function editPlanStep(prev: PersonalSaveState, formData: FormData): Promise<PersonalSaveState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const id = Number(formData.get("id"));
  const step = await prisma.personalPlanStep.findFirst({ where: { id, memberId: member.id } });
  if (!step) return { ok: false, error: "Step not found.", n };
  if (step.status === "done") return { ok: false, error: "Untick it first to edit it.", n };
  const label = String(formData.get("label") ?? "").trim().slice(0, 80);
  const amount = parseAmount(formData.get("amount"));
  if (!label) return { ok: false, error: "Name the step.", n };
  if (step.kind !== "cardbill" && (!amount || amount <= 0)) return { ok: false, error: "Enter an amount.", n };
  const amt = amount ? Math.round(amount * 100) / 100 : step.amount;
  const note = String(formData.get("note") ?? "").trim().slice(0, 120) || null;
  await prisma.$transaction(async (tx) => {
    if (step.kind === "cardbill") {
      await tx.personalPlanStep.update({ where: { id: step.id }, data: { dayOfMonth: clampDay(formData.get("dayOfMonth")), note } });
      return;
    }
    await tx.personalPlanStep.update({ where: { id: step.id }, data: { label, amount: amt, dayOfMonth: clampDay(formData.get("dayOfMonth")), note } });
    await editStepRow(tx, member.id, step, { label, amount: amt });
    await markEdited(tx, step.id);
  });
  rev();
  return { ok: true, n };
}

// Move a step one place up or down within the month. The whole month is renumbered so the order is explicit.
export async function movePlanStep(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const dir = formData.get("dir") === "up" ? -1 : 1;
  const step = await prisma.personalPlanStep.findFirst({ where: { id, memberId: member.id }, select: { id: true, periodId: true } });
  if (!step) return;
  await prisma.$transaction(async (tx) => {
    const all = await tx.personalPlanStep.findMany({ where: { periodId: step.periodId }, select: { id: true, kind: true, dayOfMonth: true, sortOrder: true, position: true, status: true } });
    const ordered = orderSteps(all);
    const visible = ordered.filter((s) => s.status !== "skipped");
    const at = visible.findIndex((s) => s.id === id);
    const neighbour = visible[at + dir];
    if (at < 0 || !neighbour) return;
    // swap the two in the full order (removed steps stay wherever they were)
    const ids = ordered.map((s) => s.id);
    const i = ids.indexOf(id);
    const j = ids.indexOf(neighbour.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await Promise.all(ids.map((sid, idx) => tx.personalPlanStep.update({ where: { id: sid }, data: { position: idx } })));
  });
  rev();
}

// Remove a step from THIS month (the Setup template still generates it next month). Restore brings it back.
// A removed bill/spend/income leaves the month's budget too (see getPersonalCash). Untick a done step first.
export async function setPlanStepSkipped(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const skip = formData.get("skip") === "1";
  const step = await prisma.personalPlanStep.findFirst({ where: { id, memberId: member.id }, select: { id: true, status: true } });
  if (!step || step.status === "done") return;
  await prisma.personalPlanStep.update({ where: { id }, data: { status: skip ? "skipped" : "pending" } });
  rev();
}

// Re-date a step within the month (1–28, or blank = anytime). Allowed whether pending or done.
export async function redatePlanStep(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const step = await prisma.personalPlanStep.findFirst({ where: { id, memberId: member.id }, select: { id: true } });
  if (!step) return;
  await prisma.$transaction(async (tx) => {
    await tx.personalPlanStep.update({ where: { id }, data: { dayOfMonth: clampDay(formData.get("dayOfMonth")) } });
    await markEdited(tx, id);
  });
  rev();
}

// Add a one-off step to this month, optionally right after another step (afterStepId; "top" = first).
// income / transfer / save are step-only; a bill or spend also creates its month row so the budget counts it.
export async function addPlanStep(prev: PersonalSaveState, formData: FormData): Promise<PersonalSaveState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const periodId = Number(formData.get("periodId"));
  const kind = String(formData.get("kind") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const amount = parseAmount(formData.get("amount"));
  const dayOfMonth = clampDay(formData.get("dayOfMonth"));
  if (!["income", "transfer", "save", "expense"].includes(kind)) return { ok: false, error: "Pick a type.", n }; // spends live in the Spends tab
  if (!label) return { ok: false, error: "Name the step.", n };
  if (!amount || amount <= 0) return { ok: false, error: "Enter an amount.", n };
  const period = await ownsPeriod(member.id, periodId);
  if (!period) return { ok: false, error: "Not your month.", n };
  const methodRaw = String(formData.get("method") ?? "");
  const method = PLAN_METHODS.has(methodRaw) ? methodRaw : null;
  const fromAcct = kind === "transfer" ? { id: await ownBalanceAccountId(member.id, formData.get("fromAccountId")) } : await ownAccount(member.id, formData.get("fromAccountId"));
  const fromAccountId = fromAcct?.id ?? null;
  const toAccountId = await ownBalanceAccountId(member.id, formData.get("toAccountId"));
  if (kind === "transfer") {
    if (!fromAccountId || !toAccountId) return { ok: false, error: "Pick both accounts.", n };
    if (fromAccountId === toAccountId) return { ok: false, error: "Pick two different accounts.", n };
  }
  const categoryId = Number(formData.get("categoryId")) || null;
  if (categoryId && !(await prisma.personalCategory.findFirst({ where: { id: categoryId, memberId: member.id }, select: { id: true } }))) return { ok: false, error: "Unknown category.", n };
  if (kind === "spend" && !categoryId) return { ok: false, error: "Pick a category for the spend.", n };
  const afterRaw = String(formData.get("afterStepId") ?? "");
  const afterId = afterRaw === "top" ? null : Number(afterRaw) || undefined;
  const amt = Math.round(amount * 100) / 100;
  const rowDate = new Date(period.year, period.month - 1, dayOfMonth ?? 1);
  const isCardFrom = fromAcct != null && "type" in fromAcct && fromAcct.type !== "bank" && fromAcct.type !== "cash";
  const card = isCardFrom ? fromAccountId : null;
  const payBank = !isCardFrom && fromAccountId ? fromAccountId : null;

  await prisma.$transaction(async (tx) => {
    let templateKind: string | null = null;
    let templateId: number | null = null;
    if (kind === "expense") {
      const row = await tx.personalExpense.create({ data: { memberId: member.id, periodId, label: label.slice(0, 80), categoryId, amount: amt, recurring: false, pending: true, cardAccountId: card, payAccountId: payBank, date: rowDate } });
      templateKind = "expense"; templateId = row.id;
    } else if (kind === "spend") {
      const row = await tx.personalSpend.create({ data: { memberId: member.id, periodId, categoryId: categoryId!, amount: amt, note: label.slice(0, 80), recurring: false, pending: true, cardAccountId: card, payAccountId: payBank, date: rowDate } });
      templateKind = "spend"; templateId = row.id;
    }
    const created = await tx.personalPlanStep.create({
      data: {
        memberId: member.id, periodId, kind, label: label.slice(0, 80), amount: amt,
        dayOfMonth, method, fromAccountId: kind === "income" ? null : fromAccountId, toAccountId: kind === "income" || kind === "transfer" ? toAccountId : null,
        note: String(formData.get("note") ?? "").trim().slice(0, 120) || null, templateKind, templateId,
      },
    });
    if (afterId !== undefined) await renumberSteps(tx, periodId, { stepId: created.id, afterId });
  });
  rev();
  return { ok: true, n };
}

// Delete a step. A template step uses "remove" instead (it would just regenerate). A one-off step — including
// a one-off bill/spend, whose month row goes with it — is deleted for good, reversing its effect if done.
export async function deletePlanStep(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const step = await prisma.personalPlanStep.findFirst({ where: { id, memberId: member.id } });
  if (!step) return;
  await prisma.$transaction(async (tx) => {
    if (!(await isOneOffRow(tx, member.id, step))) return;
    if (step.status === "done") await reversePlanStepEffect(tx, step, member.id);
    if (step.templateKind != null && step.templateId) {
      if (step.kind === "expense") await tx.personalExpense.deleteMany({ where: { id: step.templateId, memberId: member.id } });
      else if (step.kind === "spend") await tx.personalSpend.deleteMany({ where: { id: step.templateId, memberId: member.id } });
    }
    await tx.personalPlanStep.delete({ where: { id: step.id } });
  });
  rev();
}
