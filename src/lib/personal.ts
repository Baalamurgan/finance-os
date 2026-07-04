import { prisma } from "@/lib/prisma";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function personalMonthLabel(month: number, year: number) {
  return `${MONTHS[month - 1]} ${year}`;
}

// Jupiter-style starter categories (seeded once per member at onboarding; editable).
export const PERSONAL_CATEGORY_SEED: { name: string; icon: string }[] = [
  { name: "Food & Dining", icon: "🍽️" },
  { name: "Groceries", icon: "🛒" },
  { name: "Shopping", icon: "🛍️" },
  { name: "Bills & Utilities", icon: "🧾" },
  { name: "Rent", icon: "🏠" },
  { name: "Transport & Fuel", icon: "🚕" },
  { name: "Entertainment", icon: "🎬" },
  { name: "Travel", icon: "✈️" },
  { name: "Health", icon: "💊" },
  { name: "Education", icon: "📚" },
  { name: "Personal Care", icon: "💇" },
  { name: "Gifts & Donations", icon: "🎁" },
  { name: "Transfers / Sent", icon: "💸" },
  { name: "EMI & Loans", icon: "🏦" },
  { name: "Investments", icon: "📈" },
  { name: "Miscellaneous", icon: "🔧" },
];

/** Seed the starter categories for a member (idempotent — skips existing names). */
export async function seedPersonalCategories(memberId: number) {
  const existing = await prisma.personalCategory.findMany({ where: { memberId }, select: { name: true } });
  const have = new Set(existing.map((c) => c.name));
  const toCreate = PERSONAL_CATEGORY_SEED.filter((c) => !have.has(c.name));
  if (toCreate.length === 0) return;
  await prisma.personalCategory.createMany({
    data: toCreate.map((c, i) => ({ memberId, name: c.name, icon: c.icon, sortOrder: i })),
  });
}

/**
 * Ensure the current calendar month exists for this member (auto wind-down):
 * create it by copying `income` + the `recurring` expenses from the latest month,
 * and close the previous month. No manual step — it's just one person.
 */
export async function ensurePersonalMonth(memberId: number, now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const existing = await prisma.personalPeriod.findUnique({
    where: { memberId_year_month: { memberId, year, month } },
  });
  if (existing) return existing;

  const latest = await prisma.personalPeriod.findFirst({
    where: { memberId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  // wind-down: the previous month's remaining (salary + carry − expenses − spends)
  // carries into the new month as "Previous month remaining".
  let carryForward = 0;
  if (latest) {
    const [exp, spd] = await Promise.all([
      prisma.personalExpense.aggregate({ where: { periodId: latest.id }, _sum: { amount: true } }),
      prisma.personalSpend.aggregate({ where: { periodId: latest.id }, _sum: { amount: true } }),
    ]);
    carryForward = latest.income + latest.carryForward - (exp._sum.amount ?? 0) - (spd._sum.amount ?? 0);
  }

  return prisma.$transaction(async (tx) => {
    const p = await tx.personalPeriod.create({
      data: {
        memberId,
        year,
        month,
        label: personalMonthLabel(month, year),
        income: latest?.income ?? 0,
        carryForward,
      },
    });
    if (latest) {
      const recurring = await tx.personalExpense.findMany({
        where: { periodId: latest.id, recurring: true },
      });
      for (const e of recurring) {
        await tx.personalExpense.create({
          data: {
            memberId,
            periodId: p.id,
            label: e.label,
            categoryId: e.categoryId,
            amount: e.amount,
            note: e.note,
            recurring: true,
          },
        });
      }
      await tx.personalPeriod.update({
        where: { id: latest.id },
        data: { status: "closed", closedAt: new Date() },
      });
    }
    return p;
  });
}
