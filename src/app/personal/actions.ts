"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { ensurePersonalMonth, seedPersonalCategories } from "@/lib/personal";

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

// Confirm a period belongs to the caller (scoping guard).
async function ownsPeriod(memberId: number, periodId: number) {
  const p = await prisma.personalPeriod.findUnique({ where: { id: periodId } });
  return p && p.memberId === memberId ? p : null;
}

function rev() {
  revalidatePath("/personal", "layout");
}

// ── Onboarding ───────────────────────────────────────────────────────────────
export async function finishPersonalOnboarding(formData: FormData) {
  const member = await me();
  if (!member) return;
  await seedPersonalCategories(member.id);
  const period = await ensurePersonalMonth(member.id);

  const income = Number(formData.get("income")) || 0;
  await prisma.personalPeriod.update({ where: { id: period.id }, data: { income } });

  // recurring rows come as parallel arrays recurCat[]/recurAmt[]
  const cats = formData.getAll("recurCat").map((v) => Number(v));
  const amts = formData.getAll("recurAmt").map((v) => Number(v));
  for (let i = 0; i < cats.length; i++) {
    if (cats[i] && amts[i] > 0) {
      await prisma.personalExpense.create({
        data: { memberId: member.id, periodId: period.id, categoryId: cats[i], amount: amts[i], recurring: true },
      });
    }
  }

  await prisma.member.update({ where: { id: member.id }, data: { personalOnboarded: true } });
  redirect("/personal");
}

// ── Income ───────────────────────────────────────────────────────────────────
export async function setPersonalIncome(formData: FormData) {
  const member = await me();
  if (!member) return;
  const periodId = Number(formData.get("periodId"));
  const income = Number(formData.get("income")) || 0;
  if (!(await ownsPeriod(member.id, periodId))) return;
  await prisma.personalPeriod.update({ where: { id: periodId }, data: { income } });
  rev();
}

// ── Expenses ─────────────────────────────────────────────────────────────────
export type PersonalSaveState = { ok: boolean; error?: string; n: number };

export async function addPersonalExpense(
  prev: PersonalSaveState,
  formData: FormData,
): Promise<PersonalSaveState> {
  const n = (prev?.n ?? 0) + 1;
  const member = await me();
  if (!member) return { ok: false, error: "Signed out.", n };
  const periodId = Number(formData.get("periodId"));
  const categoryId = Number(formData.get("categoryId"));
  const amount = Number(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim() || null;
  const recurring = formData.get("recurring") === "on";
  if (!periodId || !categoryId || !amount || amount <= 0)
    return { ok: false, error: "Pick a category and amount.", n };
  if (!(await ownsPeriod(member.id, periodId))) return { ok: false, error: "Not your month.", n };
  const cat = await prisma.personalCategory.findUnique({ where: { id: categoryId } });
  if (!cat || cat.memberId !== member.id) return { ok: false, error: "Unknown category.", n };

  await prisma.personalExpense.create({
    data: { memberId: member.id, periodId, categoryId, amount, note, recurring },
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
  const categoryId = Number(formData.get("categoryId"));
  const amount = Number(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim() || null;
  const recurring = formData.get("recurring") === "on";
  const e = await prisma.personalExpense.findUnique({ where: { id } });
  if (!e || e.memberId !== member.id) return { ok: false, error: "Not found.", n };
  if (!amount || amount <= 0) return { ok: false, error: "Enter an amount.", n };
  await prisma.personalExpense.update({ where: { id }, data: { categoryId, amount, note, recurring } });
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

// ── Categories ───────────────────────────────────────────────────────────────
export async function addPersonalCategory(formData: FormData) {
  const member = await me();
  if (!member) return;
  const name = String(formData.get("name") ?? "").trim();
  const icon = String(formData.get("icon") ?? "").trim() || "🔖";
  if (!name) return;
  try {
    await prisma.personalCategory.create({ data: { memberId: member.id, name, icon, sortOrder: 999 } });
  } catch {
    /* duplicate name — ignore */
  }
  rev();
}

export async function renamePersonalCategory(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  const icon = String(formData.get("icon") ?? "").trim();
  const c = await prisma.personalCategory.findUnique({ where: { id } });
  if (!c || c.memberId !== member.id || !name) return;
  try {
    await prisma.personalCategory.update({ where: { id }, data: { name, icon: icon || c.icon } });
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
  const amount = Number(formData.get("amount"));
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
  const pay = Number(formData.get("amount"));
  const loan = await prisma.personalLoan.findUnique({ where: { id } });
  if (!loan || loan.memberId !== member.id || !pay || pay <= 0) return;
  const outstanding = Math.max(0, loan.outstanding - pay);
  await prisma.personalLoan.update({
    where: { id },
    data: { outstanding, status: outstanding <= 0.005 ? "settled" : "open" },
  });
  rev();
}

export async function settlePersonalLoan(formData: FormData) {
  const member = await me();
  if (!member) return;
  const id = Number(formData.get("id"));
  const loan = await prisma.personalLoan.findUnique({ where: { id } });
  if (!loan || loan.memberId !== member.id) return;
  await prisma.personalLoan.update({ where: { id }, data: { outstanding: 0, status: "settled" } });
  rev();
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
