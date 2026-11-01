import { prisma } from "@/lib/prisma";
import { getCardDues } from "@/lib/personal/cash";
import { revertAutoBills, replanUnplanned } from "@/lib/personal/autoBills";

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
// A credit-card bill due this month (or earlier and still unpaid): one step per card+cycle.
export type CardBillTemplate = { templateId: number; cardId: number; label: string; amount: number; dayOfMonth: number | null; dueNote: string | null };

// A card-bill step is unique per (card, statement date). Pack both into the step's integer templateId:
// cardId * 100000 + whole days since 2020-01-01 (from the cycle-end's LOCAL date parts, so it is stable
// across server time zones). Decodable, so a step can be matched to its PersonalCardBill row.
const CB_EPOCH_DAYS = Date.UTC(2020, 0, 1) / 86400000;
export function cardBillTemplateId(cardId: number, cycleEnd: Date): number {
  const days = Math.round(Date.UTC(cycleEnd.getFullYear(), cycleEnd.getMonth(), cycleEnd.getDate()) / 86400000) - CB_EPOCH_DAYS;
  return cardId * 100000 + days;
}
export function decodeCardBillTemplateId(id: number): { cardId: number; cycleEnd: Date } {
  const cardId = Math.floor(id / 100000);
  const d = new Date(Date.UTC(2020, 0, 1) + (id % 100000) * 86400000);
  return { cardId, cycleEnd: new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) };
}
export type NewStepData = {
  kind: string; label: string; amount: number; dayOfMonth: number | null;
  fromAccountId: number | null; toAccountId: number | null; note: string | null;
  templateKind: string; templateId: number; sortOrder: number;
};

const tKey = (kind: string | null, id: number | null) => `${kind}:${id}`;

// Pure: given this month's templates and the steps already materialised, decide which steps to create and
// which stale pending template-steps to prune.
export type BaseIncome = { periodId: number; amount: number; accountId: number | null };

export function diffPlanSteps(
  incomes: IncomeTemplate[],
  planItems: PlanItemTemplate[],
  expenses: BillTemplate[],
  spends: BillTemplate[],
  baseIncome: BaseIncome | null,
  existing: ExistingStep[],
  cardBills: CardBillTemplate[] = [],
): { toCreate: NewStepData[]; prunePendingIds: number[] } {
  const have = new Set(existing.filter((e) => e.templateKind).map((e) => tKey(e.templateKind, e.templateId)));
  const toCreate: NewStepData[] = [];
  let order = 0;
  // Base salary → a "Salary received" step when it names a target account (amount is read live at tick).
  if (baseIncome && baseIncome.accountId && baseIncome.amount > 0 && !have.has(tKey("baseincome", baseIncome.periodId))) {
    toCreate.push({
      kind: "income", label: "Salary", amount: baseIncome.amount, dayOfMonth: null,
      fromAccountId: null, toAccountId: baseIncome.accountId, note: null,
      templateKind: "baseincome", templateId: baseIncome.periodId, sortOrder: order++,
    });
  }
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
  // Credit-card bills due by this month's end → "cardbill" steps. The amount is the cycle's live total
  // (personal + family + annual fee), refreshed on every load while the step is pending (see ensure).
  for (const cb of cardBills) {
    if (!have.has(tKey("cardbill", cb.templateId))) {
      toCreate.push({
        kind: "cardbill", label: cb.label, amount: cb.amount, dayOfMonth: cb.dayOfMonth,
        fromAccountId: null, toAccountId: null, note: cb.dueNote,
        templateKind: "cardbill", templateId: cb.templateId, sortOrder: order++,
      });
    }
  }
  const live = new Set<string>([
    ...(baseIncome && baseIncome.accountId ? [tKey("baseincome", baseIncome.periodId)] : []),
    ...incomes.map((i) => tKey("income", i.id)),
    ...planItems.map((p) => tKey("planitem", p.id)),
    ...expenses.map((e) => tKey("expense", e.id)),
    ...spends.map((s) => tKey("spend", s.id)),
    ...cardBills.map((c) => tKey("cardbill", c.templateId)),
  ]);
  const prunePendingIds = existing
    .filter((e) => e.templateKind && e.status === "pending" && !live.has(tKey(e.templateKind, e.templateId)))
    .map((e) => e.id);
  return { toCreate, prunePendingIds };
}

// Display order: a manual position (move up/down / insert between) wins; steps without one fall back to the
// derived order — by day (undated last), then the stored sort order, then id — and sit after positioned ones.
export function orderSteps<T extends { dayOfMonth: number | null; sortOrder: number; id: number; position?: number | null }>(steps: T[]): T[] {
  const pos = (s: T) => s.position ?? Number.MAX_SAFE_INTEGER;
  return [...steps].sort(
    (a, b) => pos(a) - pos(b) || (a.dayOfMonth ?? 99) - (b.dayOfMonth ?? 99) || a.sortOrder - b.sortOrder || a.id - b.id,
  );
}

// Idempotently materialise this month's steps from the templates. Safe to call on every plan-page load.
export async function ensurePlanSteps(memberId: number, periodId: number): Promise<void> {
  await revertAutoBills(memberId); // undo any silent due-day auto-debit from the earlier version…
  await replanUnplanned(memberId, periodId); // …and bring back the bills/spends it marked paid without a trace, then plan as normal
  const [incomes, planItems, expenses, spends, existing, period, dues, paidBills] = await Promise.all([
    prisma.personalIncome.findMany({
      where: { periodId, recurring: true },
      select: { id: true, source: true, amount: true, date: true, accountId: true },
    }),
    prisma.personalPlanItem.findMany({
      where: { memberId, active: true },
      select: { id: true, kind: true, label: true, amount: true, dayOfMonth: true, fromAccountId: true, toAccountId: true, note: true },
    }),
    // Still-unpaid planned bills (Setup's recurring expenses + one-offs added in the plan) are steps: ticking one
    // pays it from its account. They count in the month's budget from day one either way. Pre-cutover months
    // (rows default pending=false) stay on the old model.
    prisma.personalExpense.findMany({
      where: { periodId, pending: true },
      select: { id: true, label: true, amount: true, date: true, cardAccountId: true, payAccountId: true },
    }),
    // Still-unpaid planned spends (recurring + one-offs): ticking one pays it from the chosen Cash/UPI or card
    // and draws down Can-spend.
    prisma.personalSpend.findMany({
      where: { periodId, pending: true },
      select: { id: true, note: true, amount: true, date: true, cardAccountId: true, payAccountId: true, category: { select: { name: true } } },
    }),
    prisma.personalPlanStep.findMany({
      where: { periodId },
      select: { id: true, templateKind: true, templateId: true, status: true, amount: true, label: true, toAccountId: true, fromAccountId: true, snapshot: true },
    }),
    prisma.personalPeriod.findUnique({ where: { id: periodId }, select: { income: true, incomeAccountId: true, year: true, month: true } }),
    getCardDues(memberId),
    prisma.personalCardBill.findMany({ where: { memberId }, select: { cardAccountId: true, cycleEnd: true } }),
  ]);

  // Credit-card bills: every GENERATED, unpaid cycle whose due date is on/before this month's end (earlier
  // ones are overdue and still owed). Same cut-off the family plan uses, so both views agree.
  const monthEnd = period ? new Date(period.year, period.month, 0, 23, 59, 59).getTime() : 0;
  const cardBills: CardBillTemplate[] = [];
  if (period) {
    for (const d of dues) {
      for (const cyc of d.cycles) {
        if (!cyc.generated || !cyc.dueISO) continue;
        const due = new Date(cyc.dueISO);
        if (due.getTime() > monthEnd) continue;
        const total = Math.round((cyc.total + cyc.familyTotal + cyc.annualFee) * 100) / 100;
        if (total <= 0.005) continue;
        const inMonth = due.getFullYear() === period.year && due.getMonth() + 1 === period.month;
        cardBills.push({
          templateId: cardBillTemplateId(d.cardId, new Date(cyc.cycleEndISO)),
          cardId: d.cardId, label: `${d.cardName} bill`, amount: total,
          dayOfMonth: inMonth ? Math.min(28, due.getDate()) : 1,
          dueNote: `due ${due.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
        });
      }
    }
  }

  const { toCreate, prunePendingIds: pruneCandidates } = diffPlanSteps(
    incomes.map((i) => ({ id: i.id, source: i.source, amount: i.amount, dayOfMonth: i.date.getDate(), accountId: i.accountId })),
    planItems,
    expenses.map((e) => ({ id: e.id, label: e.label || "Bill", amount: e.amount, dayOfMonth: e.date.getDate(), fromAccountId: e.cardAccountId ?? e.payAccountId })),
    spends.map((s) => ({ id: s.id, label: s.note?.trim() || s.category?.name || "Spend", amount: s.amount, dayOfMonth: s.date.getDate(), fromAccountId: s.cardAccountId ?? s.payAccountId })),
    period ? { periodId, amount: period.income, accountId: period.incomeAccountId } : null,
    existing,
    cardBills,
  );

  // A card-bill step whose cycle is no longer unpaid because it WAS paid (here or from the card page) turns
  // done instead of vanishing; one that simply isn't due/owed any more is pruned like any stale template.
  const paidKeys = new Set(paidBills.map((b) => cardBillTemplateId(b.cardAccountId, b.cycleEnd)));
  const stepById = new Map(existing.map((e) => [e.id, e]));
  const markDoneIds: number[] = [];
  const prunePendingIds: number[] = [];
  for (const id of pruneCandidates) {
    const e = stepById.get(id);
    if (e?.templateKind === "cardbill" && e.templateId != null && paidKeys.has(e.templateId)) markDoneIds.push(id);
    else prunePendingIds.push(id);
  }
  // Keep a pending card-bill step's amount live (the cycle's total moves as spends land).
  const liveAmount = new Map(cardBills.map((c) => [c.templateId, c.amount]));
  const refresh = existing.filter((e) => e.templateKind === "cardbill" && e.status === "pending" && e.templateId != null && liveAmount.has(e.templateId) && Math.abs((liveAmount.get(e.templateId) ?? 0) - e.amount) > 0.005);

  // Keep a still-pending, never-edited-this-month step in step with its Setup row: change the amount / name /
  // account in Setup and the plan shows it. A month-only edit leaves a snapshot on the step, so those are
  // left alone (the day is never synced — re-dating a step is its own month-only choice).
  const synced: { id: number; data: { label?: string; amount?: number; fromAccountId?: number | null; toAccountId?: number | null } }[] = [];
  for (const e of existing) {
    if (e.status !== "pending" || e.templateId == null || e.snapshot != null) continue;
    let want: { label: string; amount: number; fromAccountId?: number | null; toAccountId?: number | null } | null = null;
    if (e.templateKind === "income") {
      const r = incomes.find((x) => x.id === e.templateId);
      if (r) want = { label: r.source, amount: r.amount, toAccountId: r.accountId };
    } else if (e.templateKind === "baseincome" && period && e.templateId === periodId) {
      want = { label: e.label, amount: period.income, toAccountId: period.incomeAccountId };
    } else if (e.templateKind === "expense") {
      const r = expenses.find((x) => x.id === e.templateId);
      if (r) want = { label: r.label || "Bill", amount: r.amount, fromAccountId: r.cardAccountId ?? r.payAccountId };
    } else if (e.templateKind === "spend") {
      const r = spends.find((x) => x.id === e.templateId);
      if (r) want = { label: r.note?.trim() || r.category?.name || "Spend", amount: r.amount, fromAccountId: r.cardAccountId ?? r.payAccountId };
    }
    if (!want) continue;
    const data: { label?: string; amount?: number; fromAccountId?: number | null; toAccountId?: number | null } = {};
    if (want.label !== e.label) data.label = want.label;
    if (Math.abs(want.amount - e.amount) > 0.005) data.amount = want.amount;
    if (want.fromAccountId !== undefined && want.fromAccountId !== e.fromAccountId) data.fromAccountId = want.fromAccountId;
    if (want.toAccountId !== undefined && want.toAccountId !== e.toAccountId) data.toAccountId = want.toAccountId;
    if (Object.keys(data).length) synced.push({ id: e.id, data });
  }

  if (toCreate.length === 0 && prunePendingIds.length === 0 && markDoneIds.length === 0 && refresh.length === 0 && synced.length === 0) return;
  await prisma.$transaction([
    ...toCreate.map((s) => prisma.personalPlanStep.create({ data: { memberId, periodId, ...s } })),
    ...(prunePendingIds.length ? [prisma.personalPlanStep.deleteMany({ where: { id: { in: prunePendingIds } } })] : []),
    ...(markDoneIds.length ? [prisma.personalPlanStep.updateMany({ where: { id: { in: markDoneIds } }, data: { status: "done", doneAt: new Date() } })] : []),
    ...refresh.map((e) => prisma.personalPlanStep.update({ where: { id: e.id }, data: { amount: liveAmount.get(e.templateId!)! } })),
    ...synced.map((u) => prisma.personalPlanStep.update({ where: { id: u.id }, data: u.data })),
  ]);
}
