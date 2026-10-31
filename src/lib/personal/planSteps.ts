import { prisma } from "@/lib/prisma";

// Generation + ordering for the personal Money-Plan steps. A month's steps are materialised from two
// template sources — recurring income rows (recurring = true PersonalIncome in the month) and the member's
// active PersonalPlanItem transfers/saves — plus any one-off steps the member added by hand. Generation is
// idempotent (create-if-missing, keyed by templateKind+templateId), so visiting the plan repeatedly never
// duplicates a step, and an explicit done/re-date/skip on a step is preserved. A pending template-step
// whose template has since been removed is pruned; a done/skipped one is kept (it already happened).
// The diff is pure so it is unit-tested directly.

export type IncomeTemplate = { id: number; source: string; amount: number; dayOfMonth: number | null; accountId: number | null };
export type PlanItemTemplate = { id: number; kind: string; label: string; amount: number; dayOfMonth: number | null; fromAccountId: number | null; toAccountId: number | null; note: string | null };
export type BillTemplate = { id: number; label: string; amount: number; dayOfMonth: number | null; fromAccountId: number | null };
export type ExistingStep = { id: number; templateKind: string | null; templateId: number | null; status: string };
export type NewStepData = {
  kind: string; label: string; amount: number; dayOfMonth: number | null;
  fromAccountId: number | null; toAccountId: number | null; note: string | null;
  templateKind: string; templateId: number; sortOrder: number;
};

const tKey = (kind: string | null, id: number | null) => `${kind}:${id}`;

// Pure: given this month's templates and the steps already materialised, decide which steps to create and
// which stale pending template-steps to prune.
export function diffPlanSteps(
  incomes: IncomeTemplate[],
  planItems: PlanItemTemplate[],
  expenses: BillTemplate[],
  spends: BillTemplate[],
  existing: ExistingStep[],
): { toCreate: NewStepData[]; prunePendingIds: number[] } {
  const have = new Set(existing.filter((e) => e.templateKind).map((e) => tKey(e.templateKind, e.templateId)));
  const toCreate: NewStepData[] = [];
  let order = 0;
  for (const inc of incomes) {
    if (!have.has(tKey("income", inc.id))) {
      toCreate.push({
        kind: "income", label: inc.source, amount: inc.amount, dayOfMonth: inc.dayOfMonth,
        fromAccountId: null, toAccountId: inc.accountId, note: null,
        templateKind: "income", templateId: inc.id, sortOrder: order++,
      });
    }
  }
  for (const it of planItems) {
    if (!have.has(tKey("planitem", it.id))) {
      toCreate.push({
        kind: it.kind, label: it.label, amount: it.amount, dayOfMonth: it.dayOfMonth,
        fromAccountId: it.fromAccountId, toAccountId: it.toAccountId, note: it.note,
        templateKind: "planitem", templateId: it.id, sortOrder: order++,
      });
    }
  }
  // Pending recurring bills/spends → expense/spend steps. fromAccountId is the paid-from account (the
  // bill/spend's cardAccountId) for display; ticking the step marks the row executed (counts in Can-spend).
  for (const [kind, bills] of [["expense", expenses], ["spend", spends]] as const) {
    for (const b of bills) {
      if (!have.has(tKey(kind, b.id))) {
        toCreate.push({
          kind, label: b.label, amount: b.amount, dayOfMonth: b.dayOfMonth,
          fromAccountId: b.fromAccountId, toAccountId: null, note: null,
          templateKind: kind, templateId: b.id, sortOrder: order++,
        });
      }
    }
  }
  const live = new Set<string>([
    ...incomes.map((i) => tKey("income", i.id)),
    ...planItems.map((p) => tKey("planitem", p.id)),
    ...expenses.map((e) => tKey("expense", e.id)),
    ...spends.map((s) => tKey("spend", s.id)),
  ]);
  const prunePendingIds = existing
    .filter((e) => e.templateKind && e.status === "pending" && !live.has(tKey(e.templateKind, e.templateId)))
    .map((e) => e.id);
  return { toCreate, prunePendingIds };
}

// Display order: by day (undated last), then the stored sort order, then id.
export function orderSteps<T extends { dayOfMonth: number | null; sortOrder: number; id: number }>(steps: T[]): T[] {
  return [...steps].sort(
    (a, b) => (a.dayOfMonth ?? 99) - (b.dayOfMonth ?? 99) || a.sortOrder - b.sortOrder || a.id - b.id,
  );
}

// Idempotently materialise this month's steps from the templates. Safe to call on every plan-page load.
export async function ensurePlanSteps(memberId: number, periodId: number): Promise<void> {
  const [incomes, planItems, expenses, spends, existing] = await Promise.all([
    prisma.personalIncome.findMany({
      where: { periodId, recurring: true },
      select: { id: true, source: true, amount: true, date: true, accountId: true },
    }),
    prisma.personalPlanItem.findMany({
      where: { memberId, active: true },
      select: { id: true, kind: true, label: true, amount: true, dayOfMonth: true, fromAccountId: true, toAccountId: true, note: true },
    }),
    // Only PENDING recurring bills/spends become steps — executed (ticked) ones already count, and
    // pre-cutover months (pending defaulted false) stay on the old model.
    prisma.personalExpense.findMany({
      where: { periodId, recurring: true, pending: true },
      select: { id: true, label: true, amount: true, date: true, cardAccountId: true },
    }),
    prisma.personalSpend.findMany({
      where: { periodId, recurring: true, pending: true },
      select: { id: true, note: true, amount: true, date: true, cardAccountId: true, category: { select: { name: true } } },
    }),
    prisma.personalPlanStep.findMany({
      where: { periodId },
      select: { id: true, templateKind: true, templateId: true, status: true },
    }),
  ]);
  const { toCreate, prunePendingIds } = diffPlanSteps(
    incomes.map((i) => ({ id: i.id, source: i.source, amount: i.amount, dayOfMonth: i.date.getDate(), accountId: i.accountId })),
    planItems,
    expenses.map((e) => ({ id: e.id, label: e.label || "Bill", amount: e.amount, dayOfMonth: e.date.getDate(), fromAccountId: e.cardAccountId })),
    spends.map((s) => ({ id: s.id, label: s.note?.trim() || s.category?.name || "Spend", amount: s.amount, dayOfMonth: s.date.getDate(), fromAccountId: s.cardAccountId })),
    existing,
  );
  if (toCreate.length === 0 && prunePendingIds.length === 0) return;
  await prisma.$transaction([
    ...toCreate.map((s) => prisma.personalPlanStep.create({ data: { memberId, periodId, ...s } })),
    ...(prunePendingIds.length ? [prisma.personalPlanStep.deleteMany({ where: { id: { in: prunePendingIds } } })] : []),
  ]);
}
