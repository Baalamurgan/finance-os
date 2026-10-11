import { prisma } from "@/lib/prisma";
import { billCyclePhase } from "@/lib/schedule";
import { formatINR } from "@/lib/format";
import type { Payable } from "@/lib/priority/rank";

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Assemble this month's cost-bearing payables for the Priority board (read-only).
 *
 * Two sources, normalized to the engine's `Payable` shape:
 *   • Loans (the Loan table) — a loan WITH an EMI (`monthlyAmount > 0`) is a reducing loan →
 *     mandatory, cost = this month's interest on the balance; a loan with NO EMI is treated as
 *     interest-only (gold/jewel) → deferrable, each ₹ of principal cut saves `rate/1200` per month.
 *     Chits ride along as mandatory installments. The EMI/interest-only split and the mandatory
 *     defaults are only *defaults* — the board lets the user flip any row.
 *   • Tax/penalty bills — this month's UNPAID bill lines whose category carries an early-incentive
 *     or late-penalty (the property/water-tax model). We take the line's actual `amount` (the fund
 *     is already baked in by the Sheet) and derive the cost from the category + cycle phase:
 *       – incentive window → forfeit `billAmount − earlyAmount` once if you don't pay early;
 *       – deadline / overdue → `billAmount × latePenaltyPct%` accrues every further month;
 *       – a mid-cycle saving share → no penalty yet (deferring just re-spreads).
 *
 * Nothing is written. Ordinary 0%-bills (rent/EB/food) are assumed paid from essentials before the
 * typed balance, so they're out of scope for V1 — the balance you type is what's left for debt + taxes.
 */
export async function getPriorityPayables(
  householdId: number,
  period: { id: number; month: number } | null,
): Promise<Payable[]> {
  const payables: Payable[] = [];

  const loans = await prisma.loan.findMany({
    where: { householdId, status: "active" },
    select: { id: true, name: true, kind: true, outstanding: true, monthlyAmount: true, interestRate: true },
    orderBy: { name: "asc" },
  });

  for (const l of loans) {
    const id = `loan:${l.id}`;
    if (l.kind === "chit") {
      if (l.monthlyAmount > 0) {
        payables.push({ id, label: l.name, kind: "chit", amount: round2(l.monthlyAmount), divisible: false, mandatoryDefault: true, sub: "chit installment" });
      }
      continue;
    }
    const rate = l.interestRate ?? 0;
    const rateTxt = rate > 0 ? ` @ ${rate}%` : "";
    if (l.monthlyAmount > 0) {
      // Reducing-balance loan with an EMI → mandatory (default/credit risk). The cost shown is the
      // monthly interest the balance is costing you (informational — the EMI itself pays first).
      payables.push({
        id,
        label: l.name,
        kind: "loan_emi",
        amount: round2(l.monthlyAmount),
        divisible: false,
        mandatoryDefault: true,
        annualRatePct: rate || null,
        monthlyCost: rate > 0 ? round2((l.outstanding * rate) / 1200) : 0,
        sub: `EMI ${formatINR(l.monthlyAmount)} · ${formatINR(l.outstanding)} left${rateTxt}`,
      });
    } else if (l.outstanding > 0) {
      // No EMI → treat as interest-only / jewel: deferrable, each ₹ of principal saves rate/1200 a month.
      payables.push({
        id,
        label: l.name,
        kind: "loan_interest",
        amount: round2(l.outstanding),
        divisible: true,
        mandatoryDefault: false,
        annualRatePct: rate || null,
        sub: `${formatINR(l.outstanding)} left${rateTxt} · interest-only`,
      });
    }
  }

  if (period) {
    const lines = await prisma.expenseEntry.findMany({
      where: {
        periodId: period.id,
        paid: false,
        category: { OR: [{ earlyAmount: { not: null } }, { latePenaltyPct: { not: null } }] },
      },
      include: { category: true },
    });
    for (const e of lines) {
      if (e.amount <= 0) continue; // pre-paid / zero lines drop out
      const cat = e.category;
      const id = `tax:${e.id}`;
      const billAmount = cat.billAmount ?? e.amount;
      const pct = cat.latePenaltyPct ?? 0;
      const isOverdue = /\(overdue\)/i.test(e.label);
      const phase =
        cat.billMonth != null && cat.billEveryMonths != null
          ? billCyclePhase(cat.billMonth, cat.billEveryMonths, period.month)
          : null;

      if (isOverdue || phase?.isDeadlineMonth) {
        payables.push({
          id,
          label: e.label,
          kind: "tax_due",
          amount: round2(e.amount),
          divisible: false,
          mandatoryDefault: false,
          monthlyCost: pct > 0 ? round2((billAmount * pct) / 100) : 0,
          sub: isOverdue ? `overdue · ${pct}%/mo penalty on ${formatINR(billAmount)}` : `deadline this month · ${pct}%/mo if missed`,
        });
      } else if (phase?.isDueMonth && cat.earlyAmount != null) {
        payables.push({
          id,
          label: e.label,
          kind: "tax_window",
          amount: round2(e.amount),
          divisible: false,
          mandatoryDefault: false,
          oneTimeCost: round2(Math.max(0, billAmount - cat.earlyAmount)),
          sub: `incentive window · save ${formatINR(Math.max(0, billAmount - cat.earlyAmount))} by paying early`,
        });
      } else {
        payables.push({
          id,
          label: e.label,
          kind: "tax_share",
          amount: round2(e.amount),
          divisible: false,
          mandatoryDefault: false,
          sub: "monthly set-aside · no penalty yet",
        });
      }
    }
  }

  return payables;
}
