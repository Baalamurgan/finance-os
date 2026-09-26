import { prisma } from "@/lib/prisma";

// Loan reminders for the Today dashboard / Good-morning briefing:
//   • EMI due — an active loan's monthly EMI hasn't been recorded this calendar month and its due day is
//     within the nag window (or already past). "Paid this month" = a LoanPayment logged this month (the
//     Sheet-linked flow creates one when the EMI line is marked paid; manual payments count too).
//   • Prepayment planned — an unpaid loan-linked prepayment line sitting in the open month, so the extra
//     principal you meant to pay doesn't quietly slip.
// Reuses the same household master switch (billRemindersOn) and lead-time as ordinary bill reminders, and
// the same recipient rule (responsible member + head/managers).

import { BILL_REMINDER_WINDOW_DAYS } from "@/lib/billReminders";

export type LoanReminder = {
  loanId: number;
  name: string;
  kind: "emi" | "prepayment";
  dueISO: string;
  daysUntilDue: number; // negative = overdue
  overdue: boolean;
  amount: number | null;
  recipientIds: number[];
};

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const OVERDUE_LIMIT_DAYS = 60; // stop nagging after this long overdue

export async function getLoanReminders(householdId: number, now = new Date()): Promise<LoanReminder[]> {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: { billRemindersOn: true },
  });
  if (!household || !household.billRemindersOn) return [];

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [members, loans, paidThisMonth, openPeriod] = await Promise.all([
    prisma.member.findMany({ where: { householdId }, select: { id: true, role: true } }),
    prisma.loan.findMany({
      where: { householdId, kind: "loan", status: "active" },
      select: { id: true, name: true, outstanding: true, startDate: true, emiAmount: true, monthlyAmount: true, memberId: true },
    }),
    prisma.loanPayment.groupBy({
      by: ["loanId"],
      where: { loan: { householdId }, paidOn: { gte: monthStart } },
      _count: { _all: true },
    }),
    prisma.period.findFirst({ where: { householdId, status: "open" }, orderBy: [{ year: "desc" }, { month: "desc" }], select: { id: true, year: true, month: true } }),
  ]);

  const leaders = members.filter((m) => m.role === "head" || m.role === "manager").map((m) => m.id);
  const paidLoanIds = new Set(paidThisMonth.map((p) => p.loanId));
  const today = midnight(now);
  const window = BILL_REMINDER_WINDOW_DAYS;
  const out: LoanReminder[] = [];
  const recipients = (respId: number | null) => [...new Set([...(respId != null ? [respId] : []), ...leaders])];
  const daysFrom = (d: Date) => Math.round((midnight(d).getTime() - today.getTime()) / 86400000);

  // ── EMI due (this calendar month, unpaid) ──
  for (const l of loans) {
    if (l.outstanding <= 0 || paidLoanIds.has(l.id)) continue;
    const emi = (l.emiAmount ?? l.monthlyAmount) || 0;
    if (emi <= 0 || !l.startDate) continue; // no EMI amount or no known due day → can't nag honestly
    const dueDay = Math.min(28, Math.max(1, new Date(l.startDate).getDate()));
    const due = new Date(now.getFullYear(), now.getMonth(), dueDay);
    const days = daysFrom(due);
    if (days > window || days < -OVERDUE_LIMIT_DAYS) continue; // due later this month, or ancient
    out.push({ loanId: l.id, name: l.name, kind: "emi", dueISO: midnight(due).toISOString(), daysUntilDue: days, overdue: days < 0, amount: emi, recipientIds: recipients(l.memberId) });
  }

  // ── Planned prepayments (unpaid loan-linked lines in the open month) ──
  if (openPeriod) {
    const prepayLines = await prisma.expenseEntry.findMany({
      where: { periodId: openPeriod.id, loanPaymentType: "prepayment", paid: false, loanId: { not: null } },
      select: { amount: true, dueDay: true, memberId: true, loanId: true, loan: { select: { name: true } } },
    });
    for (const e of prepayLines) {
      const dueDay = Math.min(28, Math.max(1, e.dueDay ?? 1));
      const due = new Date(openPeriod.year, openPeriod.month - 1, dueDay);
      const days = daysFrom(due);
      if (days > window || days < -OVERDUE_LIMIT_DAYS) continue;
      out.push({ loanId: e.loanId!, name: e.loan?.name ?? "Loan", kind: "prepayment", dueISO: midnight(due).toISOString(), daysUntilDue: days, overdue: days < 0, amount: e.amount, recipientIds: recipients(e.memberId) });
    }
  }

  return out.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}
