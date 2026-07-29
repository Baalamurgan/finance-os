import { prisma } from "@/lib/prisma";
import { isLumpDue } from "@/lib/schedule";

// Bill-due reminders (item: high-alert popups 3 days before a bill's due date, then daily
// until it's marked paid). Covers every kind of household bill:
//   • periodic / annual bills — categories with a due month (bill-with-a-fund + full-bill-
//     on-due-month). "Paid" = a BillPayment exists for that due period. (EB, taxes, insurance)
//   • monthly fixed bills — categories with fixed=true. "Paid" = this month's Sheet line is
//     ticked paid.
// Gated by the household master switch (billRemindersOn) and each bill's own `remind` flag.
// Recipients = the responsible/paying member + the head + any managers.

export type BillReminder = {
  categoryId: number;
  name: string;
  dueISO: string;
  daysUntilDue: number; // negative = overdue
  overdue: boolean;
  amount: number | null;
  recipientIds: number[];
};

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const BILL_REMINDER_WINDOW_DAYS = 3; // start nagging this many days before due
const OVERDUE_LIMIT_DAYS = 60; // stop nagging after this long overdue (avoids ancient noise)

export async function getBillReminders(householdId: number, now = new Date()): Promise<BillReminder[]> {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: { billRemindersOn: true },
  });
  if (!household || !household.billRemindersOn) return [];

  const [members, categories, periods, billPayments] = await Promise.all([
    prisma.member.findMany({ where: { householdId }, select: { id: true, role: true } }),
    prisma.category.findMany({
      where: { householdId, remind: true, onHold: false, kind: "expense" },
      select: {
        id: true, name: true, fixed: true, billEveryMonths: true, billMonth: true, billDay: true,
        billAmount: true, responsibleMemberId: true, payerMemberId: true, reminderDays: true,
      },
    }),
    prisma.period.findMany({ where: { householdId }, select: { id: true, year: true, month: true, status: true } }),
    prisma.billPayment.findMany({ where: { householdId }, select: { categoryId: true, periodId: true } }),
  ]);

  const leaders = members.filter((m) => m.role === "head" || m.role === "manager").map((m) => m.id);
  const paidSet = new Set(billPayments.map((p) => `${p.categoryId}:${p.periodId}`));
  const periodByYM = new Map(periods.map((p) => [`${p.year}:${p.month}`, p]));
  const openPeriod =
    periods.filter((p) => p.status === "open").sort((a, b) => b.year - a.year || b.month - a.month)[0] ?? null;

  // Monthly-fixed paid detection: which categories have a line this open month, and if it's paid.
  const fixedHasLine = new Set<number>();
  const fixedPaid = new Set<number>();
  const fixedPayer = new Map<number, number | null>();
  if (openPeriod) {
    const lines = await prisma.expenseEntry.findMany({
      where: { periodId: openPeriod.id },
      select: { categoryId: true, paid: true, memberId: true },
    });
    for (const l of lines) {
      if (l.categoryId == null) continue;
      fixedHasLine.add(l.categoryId);
      if (l.paid) fixedPaid.add(l.categoryId);
      if (!fixedPayer.has(l.categoryId)) fixedPayer.set(l.categoryId, l.memberId);
    }
  }

  const today = midnight(now);
  const out: BillReminder[] = [];

  const inWindow = (days: number, window: number) => days <= window && days >= -OVERDUE_LIMIT_DAYS;
  const push = (dueDate: Date, catId: number, name: string, amount: number | null, respIds: (number | null)[]) => {
    const days = Math.round((midnight(dueDate).getTime() - today.getTime()) / 86400000);
    const recipientIds = [...new Set([...respIds.filter((x): x is number => x != null), ...leaders])];
    out.push({ categoryId: catId, name, dueISO: midnight(dueDate).toISOString(), daysUntilDue: days, overdue: days < 0, amount, recipientIds });
  };

  for (const c of categories) {
    const day = c.billDay && c.billDay >= 1 && c.billDay <= 28 ? c.billDay : 1; // "assume the 1st if no date"
    const window = c.reminderDays ?? BILL_REMINDER_WINDOW_DAYS; // per-bill lead time (default 3)

    // A) periodic / annual due-month bills
    if (c.billMonth != null) {
      const cycle = Math.max(1, Math.round(c.billEveryMonths ?? 12));
      let best: { date: Date; days: number } | null = null;
      for (let off = -2; off <= 3; off++) {
        const d = new Date(today.getFullYear(), today.getMonth() + off, day);
        const ym = { year: d.getFullYear(), month: d.getMonth() + 1 };
        if (!isLumpDue(c.billMonth, cycle, { month: ym.month })) continue;
        const per = periodByYM.get(`${ym.year}:${ym.month}`);
        if (per && paidSet.has(`${c.id}:${per.id}`)) continue; // paid → no nag
        const days = Math.round((d.getTime() - today.getTime()) / 86400000);
        if (!inWindow(days, window)) continue;
        if (!best || Math.abs(days) < Math.abs(best.days)) best = { date: d, days };
      }
      if (best) push(best.date, c.id, c.name, c.billAmount, [c.payerMemberId, c.responsibleMemberId]);
      continue;
    }

    // B) monthly fixed bills — only if the current open month has an unpaid line for it.
    // Due date is anchored to the OPEN period's month (which may still be last month if the
    // wind-down hasn't happened), so the nag matches the line whose paid state we checked.
    if (c.fixed && openPeriod && fixedHasLine.has(c.id) && !fixedPaid.has(c.id)) {
      const d = new Date(openPeriod.year, openPeriod.month - 1, day);
      const days = Math.round((d.getTime() - today.getTime()) / 86400000);
      if (inWindow(days, window)) push(d, c.id, c.name, c.billAmount, [c.responsibleMemberId, c.payerMemberId, fixedPayer.get(c.id) ?? null]);
    }
  }

  return out.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}
