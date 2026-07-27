"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { parseAmount } from "@/lib/format";
import { ensurePersonalMonth, ensurePersonalPreview, rebuildPersonalPreview, seedPersonalCategories } from "@/lib/personal";
import { getCardBillReminders } from "@/lib/personal/cash";

// The "high alert" CC dues for the signed-in member: bills due within 3 days (or overdue).
// Used by the after-unlock popup in BOTH family and personal views (a member's own cards).
// Deliberately amount-free — full detail lives behind the personal PIN.
export type CardHighAlert = { cardName: string; dueISO: string; daysUntilDue: number; overdue: boolean };
export async function getMyCardHighAlerts(): Promise<CardHighAlert[]> {
  const member = await me();
  if (!member) return [];
  const reminders = await getCardBillReminders(member.id);
  return reminders
    .filter((r) => r.daysUntilDue <= 3)
    .map((r) => ({ cardName: r.cardName, dueISO: r.dueISO, daysUntilDue: r.daysUntilDue, overdue: r.overdue }));
}

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

export type PersonalSaveState = { ok: boolean; error?: string; n: number };

// ── Onboarding ───────────────────────────────────────────────────────────────
export async function finishPersonalOnboarding(formData: FormData) {
  const member = await me();
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
  // Shared spend (GPay-style): the full "amount" is logged as the spend (optionally on a
  // card, deferred as usual); each other person's share becomes its own lent receivable
  // that posts back as income when received. "myShare" is what's left for you.
  const shared = formData.get("shared") === "on";
  const cardAccountId = await ccCardId(member.id, formData); // CC + shared allowed
  let splits: { name: string; amount: number }[] = [];
  let myShare = 0;
  if (shared) {
    try {
      const raw = JSON.parse(String(formData.get("splits") ?? "[]"));
      if (Array.isArray(raw)) {
        splits = raw
          .map((s) => ({ name: String(s?.name ?? "").trim(), amount: Math.round((Number(s?.amount) || 0) * 100) / 100 }))
          .filter((s) => s.name && s.amount > 0);
      }
    } catch { splits = []; }
    const othersSum = splits.reduce((t, s) => t + s.amount, 0);
    myShare = Math.round((amount - othersSum) * 100) / 100;
    if (splits.length === 0 || othersSum > amount + 0.01 || myShare < -0.01)
      return { ok: false, error: "Check the split — the shares must add up to what you paid.", n };
  }
  await prisma.$transaction(async (tx) => {
    await tx.personalSpend.create({ data: { memberId: member.id, periodId, categoryId, amount, note, cardAccountId } });
    for (const s of splits) {
      await tx.personalLoan.create({
        data: {
          memberId: member.id, direction: "lent", counterparty: s.name,
          amount: s.amount, outstanding: s.amount, note, sharedPaid: amount, sharedShare: myShare,
        },
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
  const cardAccountId = await ccCardId(member.id, formData);
  await prisma.personalSpend.update({ where: { id }, data: { categoryId, amount, note, cardAccountId } });
  rev();
  return { ok: true, n };
}

export async function deletePersonalSpend(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const s = await prisma.personalSpend.findUnique({ where: { id } });
  if (!s || s.memberId !== member.id) return;
  await prisma.personalSpend.delete({ where: { id } });
  rev();
}

// ── Credit-card bills (settle a card's cycle → real cash outflow this month) ──
export async function markCardBillPaid(formData: FormData) {
  const member = await me();
  if (!member) return;
  const cardAccountId = Number(formData.get("cardAccountId"));
  const cycleEndISO = String(formData.get("cycleEnd") ?? "");
  const amount = parseAmount(formData.get("amount"));
  const cycleTotal = parseAmount(formData.get("cycleTotal")); // tagged total for the cycle (for cashback)
  if (!cardAccountId || !cycleEndISO || !amount || amount <= 0) return;
  const card = await prisma.financeAccount.findUnique({ where: { id: cardAccountId }, select: { memberId: true, type: true } });
  if (!card || card.memberId !== member.id || card.type !== "credit_card") return;
  const cycleEnd = new Date(cycleEndISO);
  if (isNaN(cycleEnd.getTime())) return;
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
  rev();
}

export async function unmarkCardBillPaid(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const bill = await prisma.personalCardBill.findUnique({ where: { id } });
  if (!bill || bill.memberId !== member.id) return;
  const cashbackMarker = `__billcashback__:${bill.cycleEnd.toISOString()}`;
  await prisma.$transaction([
    prisma.accountTransaction.deleteMany({ where: { accountId: bill.cardAccountId, category: cashbackMarker } }),
    prisma.personalCardBill.delete({ where: { id } }),
  ]);
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
  const counterparty = String(formData.get("counterparty") ?? "").trim();
  const amount = parseAmount(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!counterparty || !amount || amount <= 0) return;
  await prisma.personalLoan.create({
    data: { memberId: member.id, direction, counterparty, amount, outstanding: amount, note },
  });
  rev();
}

export async function recordPersonalLoanPayment(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const pay = parseAmount(formData.get("amount"));
  const loan = await prisma.personalLoan.findUnique({ where: { id } });
  if (!loan || loan.memberId !== member.id || !pay || pay <= 0) return;
  const received = Math.min(pay, loan.outstanding);
  const outstanding = Math.max(0, loan.outstanding - pay);
  await prisma.personalLoan.update({
    where: { id },
    data: { outstanding, status: outstanding <= 0.005 ? "settled" : "open" },
  });
  // A shared-spend receivable (sharedPaid set): the full spend already reduced this month,
  // so the money coming back posts as income to the current month, recovering remaining.
  if (loan.sharedPaid != null && loan.direction === "lent" && received > 0) {
    await recoverSharedSpend(member.id, received, loan.counterparty);
  }
  rev();
}

export async function settlePersonalLoan(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const loan = await prisma.personalLoan.findUnique({ where: { id } });
  if (!loan || loan.memberId !== member.id) return;
  const received = loan.outstanding;
  await prisma.personalLoan.update({ where: { id }, data: { outstanding: 0, status: "settled" } });
  if (loan.sharedPaid != null && loan.direction === "lent" && received > 0) {
    await recoverSharedSpend(member.id, received, loan.counterparty);
  }
  rev();
}

// Post a received shared-spend amount back as income to the member's current open month.
async function recoverSharedSpend(memberId: number, amount: number, from: string) {
  const period = await ensurePersonalMonth(memberId);
  await prisma.personalIncome.create({
    data: { memberId, periodId: period.id, source: `Shared spend repaid${from ? ` by ${from}` : ""}`, amount: Math.round(amount * 100) / 100 },
  });
}

export async function deletePersonalLoan(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const loan = await prisma.personalLoan.findUnique({ where: { id } });
  if (!loan || loan.memberId !== member.id) return;
  await prisma.personalLoan.delete({ where: { id } });
  rev();
}
