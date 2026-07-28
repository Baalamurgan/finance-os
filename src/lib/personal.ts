import { prisma } from "@/lib/prisma";
import { CATEGORY_KINDS } from "@/lib/misc";
import { getPersonalCash } from "@/lib/personal/cash";

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
// the 50/30/20 default (need | want | invest) — reclassifiable in Setup. Single source
// lives in @/lib/misc (dependency-free, shared with the family misc sub-categories).
export const PERSONAL_CATEGORY_SEED = CATEGORY_KINDS;

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
  // A real (open/closed) month already there → done. A DRAFT for this month → promote it
  // below (the preview becomes the live month, keeping its edited salary + predicted lines).
  if (existing && existing.status !== "draft") return existing;

  // Drafts (next-month previews) are excluded from "latest" so they never drive carry/clone.
  const latest = await prisma.personalPeriod.findFirst({
    where: { memberId, status: { not: "draft" } },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  // wind-down: the previous month's cash Remaining carries into the new month. Uses the
  // shared helper so CC-tagged spends are deferred (not counted) and card bills paid that
  // month ARE deducted — exactly matching what the Sheet/Expenses show.
  const carryForward = latest ? (await getPersonalCash(latest)).canSpend : 0;

  return prisma.$transaction(async (tx) => {
    let p;
    if (existing) {
      // promote the draft → open, with the real carry recomputed (its lines/salary stay)
      p = await tx.personalPeriod.update({
        where: { id: existing.id },
        data: { status: "open", carryForward },
      });
    } else {
      p = await tx.personalPeriod.create({
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
              cardAccountId: e.cardAccountId, // a subscription on a card stays on the card
            },
          });
        }
      }
    }
    if (latest) {
      await tx.personalPeriod.update({
        where: { id: latest.id },
        data: { status: "closed", closedAt: new Date() },
      });
    }
    return p;
  });
}

// The next calendar month after (year, month).
function nextPersonalMonth(year: number, month: number) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

// Create (or return) a next-month PREVIEW draft for the member: a PersonalPeriod with
// status "draft", seeded from the latest real month — same recurring fixed lines, the same
// salary (editable), and an ESTIMATED carry = this month's current Remaining. It's editable
// like any month and is promoted to the live month automatically when it arrives.
export async function ensurePersonalPreview(memberId: number) {
  const latest = await prisma.personalPeriod.findFirst({
    where: { memberId, status: { not: "draft" } },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  if (!latest) return null; // nothing to base a preview on yet
  const { year, month } = nextPersonalMonth(latest.year, latest.month);
  const already = await prisma.personalPeriod.findUnique({ where: { memberId_year_month: { memberId, year, month } } });
  if (already) return already;
  const carryForward = (await getPersonalCash(latest)).canSpend;
  return prisma.$transaction(async (tx) => {
    const p = await tx.personalPeriod.create({
      data: { memberId, year, month, label: personalMonthLabel(month, year), status: "draft", income: latest.income, carryForward },
    });
    const recurring = await tx.personalExpense.findMany({ where: { periodId: latest.id, recurring: true } });
    for (const e of recurring) {
      await tx.personalExpense.create({
        data: { memberId, periodId: p.id, label: e.label, categoryId: e.categoryId, amount: e.amount, note: e.note, recurring: true, cardAccountId: e.cardAccountId },
      });
    }
    return p;
  });
}

// Re-seed a draft from the latest real month (drops generated recurring lines + refreshes
// the estimate), keeping any hand-added predicted spends/incomes. Returns the draft id.
export async function rebuildPersonalPreview(memberId: number, draftId: number) {
  const draft = await prisma.personalPeriod.findUnique({ where: { id: draftId } });
  if (!draft || draft.memberId !== memberId || draft.status !== "draft") return;
  const latest = await prisma.personalPeriod.findFirst({
    where: { memberId, status: { not: "draft" } },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  if (!latest) return;
  const carryForward = (await getPersonalCash(latest)).canSpend;
  await prisma.$transaction(async (tx) => {
    await tx.personalExpense.deleteMany({ where: { periodId: draftId, recurring: true } });
    const recurring = await tx.personalExpense.findMany({ where: { periodId: latest.id, recurring: true } });
    for (const e of recurring) {
      await tx.personalExpense.create({
        data: { memberId, periodId: draftId, label: e.label, categoryId: e.categoryId, amount: e.amount, note: e.note, recurring: true, cardAccountId: e.cardAccountId },
      });
    }
    await tx.personalPeriod.update({ where: { id: draftId }, data: { income: latest.income, carryForward } });
  });
}
