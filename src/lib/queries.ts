import { prisma } from "@/lib/prisma";
import { computeSettlement } from "@/lib/settlement-core";

export type Rollup = Awaited<ReturnType<typeof getRollup>>;

export async function getHousehold() {
  return prisma.household.findFirst({ orderBy: { id: "asc" } });
}

export async function getPeriods(householdId: number) {
  return prisma.period.findMany({
    where: { householdId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
}

export async function getCategories(householdId: number) {
  return prisma.category.findMany({
    where: { householdId },
    orderBy: { name: "asc" },
  });
}

export async function getMembers(householdId: number) {
  return prisma.member.findMany({
    where: { householdId },
    orderBy: { id: "asc" },
  });
}

// general Piggy balance only (variable categories); excludes sinking-fund holds
export async function getPiggyBalance(householdId: number) {
  const agg = await prisma.piggyEntry.aggregate({
    where: { householdId, kind: "piggy" },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

export type PiggyOverview = Awaited<ReturnType<typeof getPiggyOverview>>;

// Per-category sinking-fund balances, keyed by categoryId (for overdraw checks).
export async function getSinkingBalances(householdId: number) {
  const rows = await prisma.piggyEntry.groupBy({
    by: ["categoryId"],
    where: { householdId, kind: "sinking" },
    _sum: { amount: true },
  });
  const map: Record<number, number> = {};
  for (const r of rows) if (r.categoryId != null) map[r.categoryId] = r._sum.amount ?? 0;
  return map;
}

// Every Piggy/sinking transaction (deposits +, withdrawals/payments −) newest first.
export async function getPiggyHistory(householdId: number) {
  const rows = await prisma.piggyEntry.findMany({
    where: { householdId },
    include: { category: true, period: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind, // "piggy" | "sinking"
    bucket: r.kind === "sinking" ? r.category?.name ?? "Sinking" : "General Piggy",
    amount: r.amount,
    note: r.note ?? "",
    period: r.period?.label ?? null,
    createdAt: r.createdAt,
  }));
}

// General Piggy (per-category breakdown) + each sinking fund's accumulated hold.
export async function getPiggyOverview(householdId: number) {
  const entries = await prisma.piggyEntry.findMany({
    where: { householdId },
    include: { category: true },
  });

  const general = entries.filter((e) => e.kind === "piggy");
  const generalTotal = general.reduce((s, e) => s + e.amount, 0);

  const byCat = new Map<string, number>();
  for (const e of general) {
    const name = e.category?.name ?? "General";
    byCat.set(name, (byCat.get(name) ?? 0) + e.amount);
  }
  const generalByCategory = [...byCat.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  const sinkMap = new Map<
    string,
    { name: string; hold: number; cycleMonths: number | null }
  >();
  for (const e of entries.filter((x) => x.kind === "sinking")) {
    const name = e.category?.name ?? "Sinking";
    const cur = sinkMap.get(name) ?? {
      name,
      hold: 0,
      cycleMonths: e.category?.cycleMonths ?? null,
    };
    cur.hold += e.amount;
    sinkMap.set(name, cur);
  }
  const sinking = [...sinkMap.values()].sort((a, b) => b.hold - a.hold);

  return { generalTotal, generalByCategory, sinking };
}

// Month-over-month income/expense/balance across all periods (for trends).
export async function getTrends(householdId: number) {
  const periods = await prisma.period.findMany({
    where: { householdId, status: { not: "draft" } }, // exclude preview drafts
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  const ids = periods.map((p) => p.id);
  const [inc, exp] = await Promise.all([
    prisma.incomeEntry.groupBy({ by: ["periodId"], where: { periodId: { in: ids } }, _sum: { amount: true } }),
    prisma.expenseEntry.groupBy({ by: ["periodId"], where: { periodId: { in: ids } }, _sum: { amount: true } }),
  ]);
  const incMap = new Map(inc.map((r) => [r.periodId, r._sum.amount ?? 0]));
  const expMap = new Map(exp.map((r) => [r.periodId, r._sum.amount ?? 0]));
  return periods.map((p) => {
    const income = incMap.get(p.id) ?? 0;
    const expense = expMap.get(p.id) ?? 0;
    return { label: p.label, year: p.year, month: p.month, income, expense, balance: income - expense };
  });
}

/**
 * Read-only estimate of what winding down `periodId` (the current open month) will
 * do — the opening balance it carries into next month, and the Piggy left over.
 * Same math as windDownMonth / preview-rollover. Powers the next-month draft view.
 */
export async function getWindDownPreview(householdId: number, periodId: number) {
  const period = await prisma.period.findUnique({ where: { id: periodId } });
  if (!period) return null;
  const [incomes, expenses, budgets, spends, trackedCats, piggy] = await Promise.all([
    prisma.incomeEntry.findMany({ where: { periodId } }),
    prisma.expenseEntry.findMany({ where: { periodId } }),
    prisma.budget.findMany({ where: { periodId } }),
    prisma.spend.findMany({ where: { periodId } }),
    prisma.category.findMany({ where: { householdId, tracked: true, onHold: false } }),
    getPiggyOverview(householdId),
  ]);
  const income = incomes.reduce((s, i) => s + i.amount, 0);
  const expense = expenses.reduce((s, e) => s + e.amount, 0);
  const carryOut = period.carryForward + income - expense;
  const budgetOf = (c: number) => budgets.find((b) => b.categoryId === c)?.planned ?? 0;
  const spentOf = (c: number) => spends.filter((s) => s.categoryId === c).reduce((a, s) => a + s.amount, 0);

  let piggyAccrual = 0, sinkingAccrual = 0, carried = 0;
  for (const c of trackedCats) {
    const b = budgetOf(c.id);
    if (b > 0) {
      const rem = b - spentOf(c.id);
      if (c.sinking) sinkingAccrual += rem;
      else if (rem >= 0) piggyAccrual += rem;
      else carried += -rem;
    } else if (spentOf(c.id) > 0) {
      carried += spentOf(c.id);
    }
  }
  const piggyNow = piggy.generalTotal + piggy.sinking.reduce((s, x) => s + x.hold, 0);
  return {
    label: period.label,
    income, expense, surplus: income - expense,
    carryIn: period.carryForward, carryOut,
    piggyAccrual, sinkingAccrual, carried,
    piggyNow, piggyAfter: piggyNow + piggyAccrual + sinkingAccrual,
  };
}

export type Loans = Awaited<ReturnType<typeof getLoans>>;

// Loans & chits with progress + recent payments, members resolved for display.
export async function getLoans(householdId: number) {
  const [loans, members] = await Promise.all([
    prisma.loan.findMany({
      where: { householdId },
      include: { payments: { orderBy: { createdAt: "desc" }, take: 5 } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    prisma.member.findMany({ where: { householdId } }),
  ]);
  const nameOf = (id: number | null) =>
    id == null ? null : members.find((m) => m.id === id)?.name ?? null;

  const rows = loans.map((l) => ({
    id: l.id,
    name: l.name,
    kind: l.kind,
    outstanding: l.outstanding,
    monthlyAmount: l.monthlyAmount,
    memberId: l.memberId,
    memberName: nameOf(l.memberId),
    totalInstallments: l.totalInstallments,
    paidInstallments: l.paidInstallments,
    status: l.status,
    progress:
      l.kind === "chit" && l.totalInstallments
        ? Math.min(1, l.paidInstallments / l.totalInstallments)
        : null,
    payments: l.payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      principalPart: p.principalPart,
      note: p.note,
      createdAt: p.createdAt,
    })),
  }));

  const activeLoans = rows.filter((r) => r.kind === "loan" && r.status === "active");
  const activeChits = rows.filter((r) => r.kind === "chit" && r.status === "active");
  return {
    rows,
    totalOutstanding: activeLoans.reduce((s, r) => s + r.outstanding, 0),
    monthlyCommitment: rows
      .filter((r) => r.status === "active")
      .reduce((s, r) => s + r.monthlyAmount, 0),
    activeLoans,
    activeChits,
    closed: rows.filter((r) => r.status === "closed"),
  };
}

export type Settlement = Awaited<ReturnType<typeof getSettlement>>;

/**
 * Who-owes-whom for a period. Each member's net = income they own (salary) − expenses+spends
 * attributed to them. Every non-treasurer member settles that net with the treasurer (hub):
 * net > 0 → member pays treasurer; net < 0 → treasurer pays member. (Matches the family sheet.)
 */
export async function getSettlement(
  householdId: number,
  periodId: number,
  treasurerId: number | null
) {
  // Settlement is a START-of-month activity (salaries → hub). Daily spends + misc
  // logged during a month are credited to the spender in the NEXT month's
  // settlement, so this month settles against the PREVIOUS month's spends.
  const period = await prisma.period.findUnique({ where: { id: periodId } });
  const prevMonth = period ? (period.month === 1 ? 12 : period.month - 1) : 0;
  const prevYear = period ? (period.month === 1 ? period.year - 1 : period.year) : 0;
  const prevPeriod = period
    ? await prisma.period.findUnique({
        where: { householdId_year_month: { householdId, year: prevYear, month: prevMonth } },
      })
    : null;

  const [members, incomes, expenses, spends, records] = await Promise.all([
    prisma.member.findMany({ where: { householdId }, orderBy: { id: "asc" } }),
    prisma.incomeEntry.findMany({ where: { periodId } }),
    prisma.expenseEntry.findMany({ where: { periodId }, include: { category: true } }),
    prisma.spend.findMany({ where: { periodId: prevPeriod?.id ?? -1 }, include: { category: true } }),
    prisma.settlementRecord.findMany({ where: { periodId } }),
  ]);
  const prevLabel = prevPeriod?.label ?? null;

  // pure math (unit-tested in settlement-core.test.ts)
  return computeSettlement({ members, incomes, expenses, spends, records, treasurerId, prevLabel });
}

export type SettlementHistory = Awaited<ReturnType<typeof getSettlementHistory>>;

/**
 * All recorded settlement payments across months, grouped by period (newest first),
 * with member names resolved. Powers the inline History section.
 */
export async function getSettlementHistory(householdId: number) {
  const [records, members] = await Promise.all([
    prisma.settlementRecord.findMany({
      where: { householdId },
      include: { period: true },
      orderBy: { settledAt: "desc" },
    }),
    prisma.member.findMany({ where: { householdId } }),
  ]);
  const nameOf = (id: number) => members.find((m) => m.id === id)?.name ?? "?";

  const byPeriod = new Map<
    number,
    { periodId: number; label: string; year: number; month: number; items: {
      id: number; from: string; to: string; amount: number; settledAt: Date;
    }[] }
  >();
  for (const r of records) {
    const g = byPeriod.get(r.periodId) ?? {
      periodId: r.periodId,
      label: r.period.label,
      year: r.period.year,
      month: r.period.month,
      items: [],
    };
    g.items.push({
      id: r.id,
      from: nameOf(r.fromMemberId),
      to: nameOf(r.toMemberId),
      amount: r.amount,
      settledAt: r.settledAt,
    });
    byPeriod.set(r.periodId, g);
  }

  return [...byPeriod.values()].sort(
    (a, b) => b.year - a.year || b.month - a.month
  );
}

export type TrackedExpenses = Awaited<ReturnType<typeof getTrackedExpenses>>;

/**
 * Per tracked category for a period: the allocation (Budget), actual spent
 * (sum of Spends), remaining, over-budget flag, and the list of spends.
 */
export async function getTrackedExpenses(householdId: number, periodId: number) {
  const [categories, budgets, spends, sinkBal] = await Promise.all([
    prisma.category.findMany({
      where: { householdId, tracked: true, onHold: false },
      orderBy: { name: "asc" },
    }),
    prisma.budget.findMany({ where: { periodId } }),
    prisma.spend.findMany({
      where: { periodId },
      include: { member: true, category: true },
      orderBy: { createdAt: "desc" },
    }),
    getSinkingBalances(householdId),
  ]);

  const plannedByCat = new Map<number, number>();
  for (const b of budgets) plannedByCat.set(b.categoryId, b.planned);

  const cards = categories.map((cat) => {
    const rows = spends.filter((s) => s.categoryId === cat.id);
    const spent = rows.reduce((sum, s) => sum + s.amount, 0);
    const allocation = plannedByCat.get(cat.id) ?? 0;
    return {
      id: cat.id,
      name: cat.name,
      allocation,
      spent,
      remaining: allocation - spent,
      overBudget: allocation > 0 && spent > allocation,
      sinking: cat.sinking,
      fund: sinkBal[cat.id] ?? 0, // current accumulated sinking-fund balance
      // spends are fetched newest-first, so rows[0] is the latest for this card
      lastSpentAt: rows[0]?.createdAt ?? null,
      spends: rows,
    };
  });

  // Most-recently-used category first (cards with no spends fall to the bottom).
  cards.sort((a, b) => (b.lastSpentAt?.getTime() ?? 0) - (a.lastSpentAt?.getTime() ?? 0));

  // Headline totals cover BUDGETED categories only — miscellaneous (no-budget)
  // spends are shown separately and must not count against the allocation.
  const budgeted = cards.filter((c) => c.allocation > 0);
  const totalAllocation = budgeted.reduce((s, c) => s + c.allocation, 0);
  const totalSpent = budgeted.reduce((s, c) => s + c.spent, 0);
  const miscSpent = cards.filter((c) => c.allocation === 0).reduce((s, c) => s + c.spent, 0);

  return { cards, totalAllocation, totalSpent, totalRemaining: totalAllocation - totalSpent, miscSpent };
}

export type InHand = Awaited<ReturnType<typeof getInHand>>;

/**
 * "How much is still in whose hand" for a month. Per person:
 *   net = (budgeted categories still unspent) + (fixed bills they cover)
 *         − (their misc/unbudgeted spend).
 * A positive net = cash they're still holding (budgets → Piggy at wind-down;
 * fixed bills earmarked to pay). A negative net = they fronted more than they
 * hold → reclaim from the treasurer, or deduct next month. Budgeted remaining +
 * fixed bills are by the responsible/paying member; misc spend is by whoever
 * logged it. The head's account total = Piggy + their own net + the shared net.
 */
export async function getInHand(householdId: number, periodId: number) {
  const [categories, budgets, spends, fixedLines, members, piggy] = await Promise.all([
    prisma.category.findMany({ where: { householdId, tracked: true, onHold: false } }),
    prisma.budget.findMany({ where: { periodId } }),
    prisma.spend.findMany({ where: { periodId } }),
    // fixed bills are Sheet expense lines tagged to whoever pays them
    prisma.expenseEntry.findMany({ where: { periodId, category: { fixed: true } } }),
    prisma.member.findMany({ where: { householdId }, orderBy: { id: "asc" } }),
    getPiggyOverview(householdId),
  ]);
  const plannedByCat = new Map(budgets.map((b) => [b.categoryId, b.planned]));
  const spentByCat = new Map<number, number>();
  for (const s of spends) spentByCat.set(s.categoryId, (spentByCat.get(s.categoryId) ?? 0) + s.amount);

  const budgetedIds = new Set(categories.filter((c) => (plannedByCat.get(c.id) ?? 0) > 0).map((c) => c.id));

  // budgeted category rows (by responsible member)
  const rows = categories
    .filter((c) => budgetedIds.has(c.id))
    .map((cat) => ({
      id: cat.id,
      name: cat.name,
      responsibleMemberId: cat.responsibleMemberId,
      allocation: plannedByCat.get(cat.id) ?? 0,
      spent: spentByCat.get(cat.id) ?? 0,
      remaining: (plannedByCat.get(cat.id) ?? 0) - (spentByCat.get(cat.id) ?? 0),
    }));

  // misc / unbudgeted spend (by whoever logged it)
  const miscByMember = new Map<number | null, number>();
  for (const s of spends) {
    if (budgetedIds.has(s.categoryId)) continue;
    const k = s.memberId ?? null;
    miscByMember.set(k, (miscByMember.get(k) ?? 0) + s.amount);
  }

  const build = (key: number | null, name: string) => {
    const cats = rows.filter((r) => (r.responsibleMemberId ?? null) === key);
    const bills = fixedLines
      .filter((e) => (e.memberId ?? null) === key)
      .map((e) => ({ name: e.label, amount: e.amount }));
    const budgetRemaining = cats.reduce((s, r) => s + r.remaining, 0);
    const fixedTotal = bills.reduce((s, b) => s + b.amount, 0);
    const miscSpent = miscByMember.get(key) ?? 0;
    return { memberId: key, name, cats, bills, budgetRemaining, fixedTotal, miscSpent, net: budgetRemaining + fixedTotal - miscSpent };
  };

  const byPerson = members
    .map((m) => build(m.id, m.name))
    .filter((g) => g.cats.length > 0 || g.miscSpent > 0 || g.bills.length > 0);
  const shared = build(null, "Shared / pool");
  const piggyTotal = piggy.generalTotal + piggy.sinking.reduce((s, x) => s + x.hold, 0);

  return { byPerson, shared, piggyTotal };
}

/**
 * The monthly roll-up for one period: totals, by-category (with planned-vs-actual),
 * per-member attribution, necessary-vs-other, and the raw entry lists.
 */
export async function getRollup(periodId: number) {
  const [incomes, expenses, budgets, members, spends, cats] = await Promise.all([
    prisma.incomeEntry.findMany({
      where: { periodId },
      include: { owner: true },
      orderBy: { id: "asc" },
    }),
    prisma.expenseEntry.findMany({
      where: { periodId },
      include: { category: true, member: true },
      orderBy: { id: "asc" },
    }),
    prisma.budget.findMany({ where: { periodId }, include: { category: true } }),
    prisma.member.findMany({
      where: { household: { periods: { some: { id: periodId } } } },
      orderBy: { id: "asc" },
    }),
    prisma.spend.findMany({ where: { periodId } }),
    prisma.category.findMany({
      where: { household: { periods: { some: { id: periodId } } } },
    }),
  ]);

  const totalIncome = incomes.reduce((s, i) => s + i.amount, 0);
  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0);
  const balance = totalIncome - totalExpense;

  // by category: planned budget + "actual". For TRACKED categories, "actual" is
  // the real daily Spend total (matches the Expenses tab); for non-tracked it's
  // the sheet ExpenseEntry total. (totalExpense/balance above stay on ExpenseEntry.)
  const plannedByCat = new Map<number, number>();
  for (const b of budgets) plannedByCat.set(b.categoryId, b.planned);

  const expenseByCat = new Map<number, number>();
  for (const e of expenses) expenseByCat.set(e.categoryId, (expenseByCat.get(e.categoryId) ?? 0) + e.amount);

  const spendByCat = new Map<number, number>();
  for (const s of spends) spendByCat.set(s.categoryId, (spendByCat.get(s.categoryId) ?? 0) + s.amount);

  const byCategory = cats
    .map((cat) => ({
      name: cat.name,
      planned: plannedByCat.get(cat.id) ?? 0,
      actual: cat.tracked
        ? spendByCat.get(cat.id) ?? 0
        : expenseByCat.get(cat.id) ?? 0,
    }))
    .filter((r) => r.actual > 0 || r.planned > 0)
    .sort((a, b) => b.actual - a.actual);

  // per-member attribution (expenses with a member tag)
  const memberTotals = new Map<number, number>();
  for (const e of expenses) {
    if (e.memberId != null) {
      memberTotals.set(e.memberId, (memberTotals.get(e.memberId) ?? 0) + e.amount);
    }
  }
  const sharedTotal = expenses
    .filter((e) => e.memberId == null)
    .reduce((s, e) => s + e.amount, 0);
  const byMember = [
    ...members.map((m) => ({ name: m.name, total: memberTotals.get(m.id) ?? 0 })),
    { name: "Shared", total: sharedTotal },
  ].filter((m) => m.total > 0);

  // necessary vs other
  const necessary = expenses
    .filter((e) => e.necessary)
    .reduce((s, e) => s + e.amount, 0);
  const other = totalExpense - necessary;

  return {
    totalIncome,
    totalExpense,
    balance,
    byCategory,
    byMember,
    necessaryVsOther: [
      { name: "Necessary", value: necessary },
      { name: "Other", value: other },
    ],
    incomes,
    expenses,
  };
}

// Aggregate getRollup across every period in an inclusive [from, to] month range
// (for the Analysis "custom range" view). Sums totals + by-category/member/split.
export async function getRollupRange(
  householdId: number,
  fromY: number,
  fromM: number,
  toY: number,
  toM: number,
) {
  const lo = fromY * 12 + (fromM - 1);
  const hi = toY * 12 + (toM - 1);
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];

  const periods = await prisma.period.findMany({ where: { householdId } });
  const inRange = periods.filter((p) => {
    const k = p.year * 12 + (p.month - 1);
    return k >= a && k <= b;
  });
  const rollups = await Promise.all(inRange.map((p) => getRollup(p.id)));

  const totalIncome = rollups.reduce((s, r) => s + r.totalIncome, 0);
  const totalExpense = rollups.reduce((s, r) => s + r.totalExpense, 0);

  const catMap = new Map<string, { name: string; actual: number; planned: number }>();
  for (const r of rollups)
    for (const c of r.byCategory) {
      const e = catMap.get(c.name) ?? { name: c.name, actual: 0, planned: 0 };
      e.actual += c.actual;
      e.planned += c.planned;
      catMap.set(c.name, e);
    }

  const memMap = new Map<string, number>();
  for (const r of rollups)
    for (const m of r.byMember) memMap.set(m.name, (memMap.get(m.name) ?? 0) + m.total);

  const nvo = new Map<string, number>();
  for (const r of rollups)
    for (const x of r.necessaryVsOther) nvo.set(x.name, (nvo.get(x.name) ?? 0) + x.value);

  return {
    totalIncome,
    totalExpense,
    balance: totalIncome - totalExpense,
    byCategory: [...catMap.values()],
    byMember: [...memMap.entries()].map(([name, total]) => ({ name, total })).filter((m) => m.total > 0),
    necessaryVsOther: [...nvo.entries()].map(([name, value]) => ({ name, value })),
    monthsCount: inRange.length,
  };
}

// ── Activity log (head-only) ─────────────────────────────────────────────────
export async function getActivityLog(householdId: number, limit = 150) {
  return prisma.activityLog.findMany({
    where: { householdId },
    orderBy: { id: "desc" },
    take: limit,
  });
}

// ── "What changed since last month" (everyone) ──────────────────────────────
// Diffs the selected month's income + expense lines against the previous month,
// aggregating by name so it reads as simple Added / Removed / Amount-changed lists.
function diffByKey(
  cur: { key: string; amount: number }[],
  prev: { key: string; amount: number }[],
) {
  const sum = (rows: { key: string; amount: number }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.key, (m.get(r.key) ?? 0) + r.amount);
    return m;
  };
  const c = sum(cur);
  const p = sum(prev);
  const added: { label: string; amount: number }[] = [];
  const removed: { label: string; amount: number }[] = [];
  const changed: { label: string; from: number; to: number }[] = [];
  for (const [key, amt] of c) {
    if (!p.has(key)) added.push({ label: key, amount: amt });
    else if (Math.abs((p.get(key) ?? 0) - amt) >= 0.5) changed.push({ label: key, from: p.get(key) ?? 0, to: amt });
  }
  for (const [key, amt] of p) if (!c.has(key)) removed.push({ label: key, amount: amt });
  return { added, removed, changed };
}

export async function getMonthChanges(householdId: number, periodId: number) {
  const period = await prisma.period.findUnique({ where: { id: periodId } });
  if (!period) return null;
  const prevMonth = period.month === 1 ? 12 : period.month - 1;
  const prevYear = period.month === 1 ? period.year - 1 : period.year;
  const prev = await prisma.period.findUnique({
    where: { householdId_year_month: { householdId, year: prevYear, month: prevMonth } },
  });
  if (!prev) return { prevLabel: null, income: null, expense: null };

  const [curInc, curExp, prevInc, prevExp] = await Promise.all([
    prisma.incomeEntry.findMany({ where: { periodId } }),
    prisma.expenseEntry.findMany({ where: { periodId }, include: { category: true } }),
    prisma.incomeEntry.findMany({ where: { periodId: prev.id } }),
    prisma.expenseEntry.findMany({ where: { periodId: prev.id }, include: { category: true } }),
  ]);

  const isMisc = (e: { category: { section: string } | null }) => e.category?.section === "Misc";

  const income = diffByKey(
    curInc.map((i) => ({ key: i.source, amount: i.amount })),
    prevInc.map((i) => ({ key: i.source, amount: i.amount })),
  );
  // Misc is one-off and churns every month, so it gets its own block rather than
  // flooding the main expense diff.
  const expense = diffByKey(
    curExp.filter((e) => !isMisc(e)).map((e) => ({ key: e.label, amount: e.amount })),
    prevExp.filter((e) => !isMisc(e)).map((e) => ({ key: e.label, amount: e.amount })),
  );
  const misc = diffByKey(
    curExp.filter(isMisc).map((e) => ({ key: e.label, amount: e.amount })),
    prevExp.filter(isMisc).map((e) => ({ key: e.label, amount: e.amount })),
  );
  return { prevLabel: prev.label, income, expense, misc };
}

// ── Loan / chit detail (per-item page) ──────────────────────────────────────
export async function getLoanDetail(householdId: number, id: number) {
  const loan = await prisma.loan.findFirst({
    where: { id, householdId },
    include: { payments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] } },
  });
  if (!loan) return null;
  const members = await prisma.member.findMany({ where: { householdId } });
  const memberName = loan.memberId ? members.find((m) => m.id === loan.memberId)?.name ?? null : null;
  const totalPaid = loan.payments.reduce((s, p) => s + p.amount, 0);
  const totalDividend = loan.payments.reduce((s, p) => s + p.dividend, 0);
  const potReceived = loan.chitWonInstallment ? loan.chitPotAmount ?? 0 : 0;
  // chit net cost so far = paid − dividends received − pot won (if any)
  const chitNet = totalPaid - totalDividend - potReceived;
  return {
    loan,
    memberName,
    members: members.map((m) => ({ id: m.id, name: m.name })),
    totalPaid,
    totalDividend,
    potReceived,
    chitNet,
  };
}
