import { prisma } from "@/lib/prisma";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function personalMonthLabel(month: number, year: number) {
  return `${MONTHS[month - 1]} ${year}`;
}

/**
 * Which month's cycle `now` falls in, given a personal wind-down day.
 * day 1 (or unset) = plain calendar month. day D>1 = a cycle runs D→D-1, so
 * before day D you're still in the previous month's cycle.
 */
export function personalAnchor(now: Date, windDownDay?: number | null): { year: number; month: number } {
  const d = windDownDay && windDownDay >= 2 && windDownDay <= 28 ? windDownDay : 1;
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  if (d > 1 && now.getDate() < d) {
    month -= 1;
    if (month < 1) { month = 12; year -= 1; }
  }
  return { year, month };
}

/** Human date span of a cycle, e.g. "25 Sep – 24 Oct" (null for calendar months). */
export function personalCycleRange(year: number, month: number, windDownDay?: number | null): string | null {
  const d = windDownDay && windDownDay >= 2 && windDownDay <= 28 ? windDownDay : 1;
  if (d === 1) return null;
  const end = new Date(year, month, d - 1); // month is 1-based → next month, day d-1
  const short = (dt: Date) => `${dt.getDate()} ${MONTHS[dt.getMonth()][0]}${MONTHS[dt.getMonth()].slice(1, 3).toLowerCase()}`;
  return `${short(new Date(year, month - 1, d))} – ${short(end)}`;
}

// Jupiter-style starter categories (seeded once per member; editable). Bucket =
// the 50/30/20 default (need | want | invest) — reclassifiable in Setup.
export const PERSONAL_CATEGORY_SEED: { name: string; icon: string; bucket: string }[] = [
  { name: "Food & Dining", icon: "🍽️", bucket: "want" },
  { name: "Groceries", icon: "🛒", bucket: "need" },
  { name: "Shopping", icon: "🛍️", bucket: "want" },
  { name: "Bills & Utilities", icon: "🧾", bucket: "need" },
  { name: "Rent", icon: "🏠", bucket: "need" },
  { name: "Transport & Fuel", icon: "🚕", bucket: "need" },
  { name: "Entertainment", icon: "🎬", bucket: "want" },
  { name: "Travel", icon: "✈️", bucket: "want" },
  { name: "Health", icon: "💊", bucket: "need" },
  { name: "Education", icon: "📚", bucket: "need" },
  { name: "Personal Care", icon: "💇", bucket: "want" },
  { name: "Gifts & Donations", icon: "🎁", bucket: "want" },
  { name: "Transfers / Sent", icon: "💸", bucket: "want" },
  { name: "EMI & Loans", icon: "🏦", bucket: "need" },
  { name: "Investments", icon: "📈", bucket: "invest" },
  { name: "Miscellaneous", icon: "🔧", bucket: "want" },
];

/** Seed the starter categories for a member (idempotent — skips existing names). */
export async function seedPersonalCategories(memberId: number) {
  const existing = await prisma.personalCategory.findMany({ where: { memberId }, select: { name: true } });
  const have = new Set(existing.map((c) => c.name));
  const toCreate = PERSONAL_CATEGORY_SEED.filter((c) => !have.has(c.name));
  if (toCreate.length === 0) return;
  await prisma.personalCategory.createMany({
    data: toCreate.map((c, i) => ({ memberId, name: c.name, icon: c.icon, bucket: c.bucket, sortOrder: i })),
  });
}

/**
 * Ensure the current calendar month exists for this member (auto wind-down):
 * create it by copying `income` + the `recurring` expenses from the latest month,
 * and close the previous month. No manual step — it's just one person.
 */
export async function ensurePersonalMonth(memberId: number, now = new Date()) {
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: { personalWindDownDay: true } });
  const { year, month } = personalAnchor(now, member?.personalWindDownDay);
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
    const [exp, spd, extra] = await Promise.all([
      prisma.personalExpense.aggregate({ where: { periodId: latest.id }, _sum: { amount: true } }),
      prisma.personalSpend.aggregate({ where: { periodId: latest.id }, _sum: { amount: true } }),
      prisma.personalIncome.aggregate({ where: { periodId: latest.id }, _sum: { amount: true } }),
    ]);
    carryForward =
      latest.income + latest.carryForward + (extra._sum.amount ?? 0) -
      (exp._sum.amount ?? 0) - (spd._sum.amount ?? 0);
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
