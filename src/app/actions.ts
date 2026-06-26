"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { auth, signOut } from "@/auth";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export async function doSignOut() {
  await signOut({ redirectTo: "/signin" });
}

// Authorization comes from the Auth.js session role now.
async function isHead() {
  const session = await auth();
  return session?.user?.role === "head";
}

async function periodOpen(periodId: number) {
  const p = await prisma.period.findUnique({ where: { id: periodId } });
  return p?.status === "open";
}

// Create (no id) or update (id present). Head-only, open periods only.
export async function saveExpense(formData: FormData) {
  if (!(await isHead())) return;

  const id = formData.get("id") ? Number(formData.get("id")) : null;
  const periodId = Number(formData.get("periodId"));
  const categoryId = Number(formData.get("categoryId"));
  const amount = Number(formData.get("amount"));
  const label = String(formData.get("label") ?? "").trim();
  const memberRaw = formData.get("memberId");
  const memberId = memberRaw ? Number(memberRaw) : null;
  const necessaryRaw = formData.get("necessary"); // "default" | "yes" | "no"

  if (!periodId || !categoryId || !amount) return;
  if (!(await periodOpen(periodId))) return;

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  const finalLabel = label || category?.name || "Expense";
  const necessary =
    necessaryRaw === "yes" ? true : necessaryRaw === "no" ? false : (category?.necessary ?? true);
  // auto-attribute to the category's responsible member when none is picked
  const finalMemberId = memberId ?? category?.responsibleMemberId ?? null;

  if (id) {
    await prisma.expenseEntry.update({
      where: { id },
      data: { categoryId, amount, label: finalLabel, memberId: finalMemberId, necessary },
    });
  } else {
    await prisma.expenseEntry.create({
      data: { periodId, categoryId, amount, label: finalLabel, memberId: finalMemberId, necessary },
    });
  }
  revalidatePath("/", "layout");
}

export async function addIncome(formData: FormData) {
  if (!(await isHead())) return;
  const periodId = Number(formData.get("periodId"));
  const source = String(formData.get("source") ?? "").trim();
  const amount = Number(formData.get("amount"));
  const ownerRaw = formData.get("ownerId");
  const ownerId = ownerRaw ? Number(ownerRaw) : null;

  if (!periodId || !source || !amount) return;
  if (!(await periodOpen(periodId))) return;

  await prisma.incomeEntry.create({ data: { periodId, source, amount, ownerId } });
  revalidatePath("/", "layout");
}

export async function deleteExpense(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("id"));
  if (!id) return;
  const e = await prisma.expenseEntry.findUnique({ where: { id } });
  if (e && !(await periodOpen(e.periodId))) return;
  await prisma.expenseEntry.delete({ where: { id } });
  revalidatePath("/", "layout");
}

export async function deleteIncome(formData: FormData) {
  if (!(await isHead())) return;
  const id = Number(formData.get("id"));
  if (!id) return;
  const i = await prisma.incomeEntry.findUnique({ where: { id } });
  if (i && !(await periodOpen(i.periodId))) return;
  await prisma.incomeEntry.delete({ where: { id } });
  revalidatePath("/", "layout");
}

// Save an uploaded image to public/uploads and return its public path, or null.
async function saveUpload(file: FormDataEntryValue | null): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const name = `${randomUUID()}.${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return `/uploads/${name}`;
}

// Log an actual spend in a tracked category (Expenses tab).
// ANY signed-in member can log — auto-attributed to themselves (like the WhatsApp groups).
export async function addSpend(formData: FormData) {
  const session = await auth();
  const memberId = session?.user?.memberId;
  if (!memberId) return; // must be a mapped member

  const periodId = Number(formData.get("periodId"));
  const categoryId = Number(formData.get("categoryId"));
  const amount = Number(formData.get("amount"));
  const label = String(formData.get("label") ?? "").trim();

  if (!periodId || !categoryId || !amount || !label) return;
  if (!(await periodOpen(periodId))) return;

  const imagePath = await saveUpload(formData.get("image"));
  await prisma.spend.create({
    data: { periodId, categoryId, memberId, label, amount, imagePath },
  });
  revalidatePath("/", "layout");
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

  if (spend.imagePath) {
    await fs
      .unlink(path.join(process.cwd(), "public", spend.imagePath))
      .catch(() => {});
  }
  await prisma.spend.delete({ where: { id } });
  revalidatePath("/", "layout");
}

// Use Piggy money: reduce a Piggy/sinking bucket, AND post a matching income + expense
// in the chosen month (so the sheet reflects the money coming in and being used).
export async function withdrawPiggy(formData: FormData) {
  if (!(await isHead())) return;
  const periodId = Number(formData.get("periodId"));
  const amount = Number(formData.get("amount"));
  const source = String(formData.get("source") ?? "general"); // "general" | categoryId
  const expenseCategoryId = Number(formData.get("expenseCategoryId"));
  const note = String(formData.get("note") ?? "").trim() || "Piggy use";
  if (!periodId || !amount || amount <= 0 || !expenseCategoryId) return;

  const household = await prisma.household.findFirst();
  if (!household) return;
  const sinkingCatId = source !== "general" ? Number(source) : null;

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
    // 2. income line (money brought into the month)
    await tx.incomeEntry.create({
      data: { periodId, source: `From Piggy: ${note}`, amount },
    });
    // 3. matching expense line (where it went)
    const cat = await tx.category.findUnique({ where: { id: expenseCategoryId } });
    await tx.expenseEntry.create({
      data: {
        periodId,
        label: note,
        amount,
        categoryId: expenseCategoryId,
        necessary: cat?.necessary ?? true,
      },
    });
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
  if (!(await isHead())) return;
  const session = await auth();
  const householdId = Number(formData.get("householdId"));
  const periodId = Number(formData.get("periodId"));
  const fromMemberId = Number(formData.get("fromMemberId"));
  const toMemberId = Number(formData.get("toMemberId"));
  const amount = Number(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!householdId || !periodId || !fromMemberId || !toMemberId || !amount) return;

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
  if (!(await isHead())) return;
  const id = Number(formData.get("id"));
  if (!id) return;
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
  // responsible/default member: tags this category's lines + receives over-budget excess
  const respRaw = String(formData.get("responsibleMemberId") ?? "").trim();
  const responsibleMemberId = respRaw === "" ? null : Number(respRaw);

  await prisma.category.update({
    where: { id },
    data: { monthlyBudget, sinking, cycleMonths, responsibleMemberId },
  });
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
    tx.incomeEntry.findMany({ where: { periodId: sourceId } }),
    tx.expenseEntry.findMany({ where: { periodId: sourceId } }),
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
      // email intentionally NOT updated here
      await prisma.member.update({ where: { id }, data: { name, code, role } });
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
  if (!(await isHead())) return;
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
  let miscTotal = 0;
  // over-budget food etc. charged to a responsible member next month
  const excessCharges: { categoryId: number; memberId: number; amount: number; label: string }[] = [];

  const nextMonth = period.month === 12 ? 1 : period.month + 1;
  const nextYear = period.month === 12 ? period.year + 1 : period.year;
  const nextLabel = `${new Date(nextYear, nextMonth - 1, 1)
    .toLocaleString("en-US", { month: "short" })
    .toUpperCase()} ${nextYear}`;

  await prisma.$transaction(async (tx) => {
    for (const cat of trackedCats) {
      const budget = budgetOf(cat.id);
      if (budget > 0) {
        const remainder = budget - spentOf(cat.id);
        // Over budget + a responsible member set → charge the excess to that person
        // next month (matches the sheet's "provision excess exp → Harish"); no piggy hit.
        if (remainder < 0 && cat.responsibleMemberId) {
          excessCharges.push({
            categoryId: cat.id,
            memberId: cat.responsibleMemberId,
            amount: -remainder,
            label: `${cat.name} excess (${period.label})`,
          });
          continue;
        }
        await tx.piggyEntry.create({
          data: {
            householdId,
            periodId,
            categoryId: cat.id,
            kind: cat.sinking ? "sinking" : "piggy",
            amount: remainder,
            note: `${period.label} · ${cat.name}`,
          },
        });
        if (!cat.sinking) movedToPiggy += remainder;
      } else {
        // tracked but no budget = Misc → deducted from next month's income
        miscTotal += spentOf(cat.id);
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

    // Misc reduces next month's income (a negative income line)
    if (miscTotal > 0) {
      await tx.incomeEntry.create({
        data: {
          periodId: next.id,
          source: `Misc adjustment (from ${period.label})`,
          amount: -miscTotal,
        },
      });
    }

    // Over-budget food etc. → charged to the responsible member as next-month expenses
    for (const ch of excessCharges) {
      await tx.expenseEntry.create({
        data: {
          periodId: next.id,
          label: ch.label,
          amount: ch.amount,
          categoryId: ch.categoryId,
          memberId: ch.memberId,
          necessary: true,
        },
      });
    }
  });

  revalidatePath("/", "layout");
}
