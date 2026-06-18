import { prisma } from "@/lib/prisma";

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
  const [members, incomes, expenses, spends, records] = await Promise.all([
    prisma.member.findMany({ where: { householdId }, orderBy: { id: "asc" } }),
    prisma.incomeEntry.findMany({ where: { periodId } }),
    prisma.expenseEntry.findMany({ where: { periodId } }),
    prisma.spend.findMany({ where: { periodId } }),
    prisma.settlementRecord.findMany({ where: { periodId } }),
  ]);

  const rows = members.map((m) => {
    const contributed = incomes
      .filter((i) => i.ownerId === m.id)
      .reduce((s, i) => s + i.amount, 0);
    const paid =
      expenses.filter((e) => e.memberId === m.id).reduce((s, e) => s + e.amount, 0) +
      spends.filter((sp) => sp.memberId === m.id).reduce((s, sp) => s + sp.amount, 0);
    return { id: m.id, name: m.name, contributed, paid, net: contributed - paid };
  });

  const treasurer = members.find((m) => m.id === treasurerId) ?? null;
  const transfers = treasurer
    ? rows
        .filter((r) => r.id !== treasurer.id && Math.abs(r.net) >= 0.005)
        .map((r) => {
          // member → treasurer when net > 0, else treasurer → member
          const base =
            r.net > 0
              ? { fromId: r.id, from: r.name, toId: treasurer.id, to: treasurer.name, amount: r.net }
              : { fromId: treasurer.id, from: treasurer.name, toId: r.id, to: r.name, amount: -r.net };
          const rec = records.find(
            (s) => s.fromMemberId === base.fromId && s.toMemberId === base.toId
          );
          return {
            ...base,
            settled: !!rec,
            recordId: rec?.id ?? null,
            settledAt: rec?.settledAt ?? null,
            // amount drifted since it was marked paid (data edited afterwards)
            amountChanged: rec ? Math.abs(rec.amount - base.amount) >= 0.005 : false,
          };
        })
        .sort((a, b) => b.amount - a.amount)
    : [];

  const settledCount = transfers.filter((t) => t.settled).length;

  return {
    rows,
    treasurer,
    transfers,
    settledCount,
    total: transfers.length,
    allSettled: transfers.length > 0 && settledCount === transfers.length,
  };
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
  const [categories, budgets, spends] = await Promise.all([
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
      spends: rows,
    };
  });

  const totalAllocation = cards.reduce((s, c) => s + c.allocation, 0);
  const totalSpent = cards.reduce((s, c) => s + c.spent, 0);

  return { cards, totalAllocation, totalSpent, totalRemaining: totalAllocation - totalSpent };
}

/**
 * The monthly roll-up for one period: totals, by-category (with planned-vs-actual),
 * per-member attribution, necessary-vs-other, and the raw entry lists.
 */
export async function getRollup(periodId: number) {
  const [incomes, expenses, budgets, members] = await Promise.all([
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
  ]);

  const totalIncome = incomes.reduce((s, i) => s + i.amount, 0);
  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0);
  const balance = totalIncome - totalExpense;

  // by category: actual spend + planned budget
  const plannedByCat = new Map<number, number>();
  for (const b of budgets) plannedByCat.set(b.categoryId, b.planned);

  const catMap = new Map<
    number,
    { name: string; actual: number; planned: number }
  >();
  for (const e of expenses) {
    const cur = catMap.get(e.categoryId) ?? {
      name: e.category.name,
      actual: 0,
      planned: plannedByCat.get(e.categoryId) ?? 0,
    };
    cur.actual += e.amount;
    catMap.set(e.categoryId, cur);
  }
  // include budgeted categories with no expenses yet
  for (const b of budgets) {
    if (!catMap.has(b.categoryId)) {
      catMap.set(b.categoryId, {
        name: b.category.name,
        actual: 0,
        planned: b.planned,
      });
    }
  }
  const byCategory = [...catMap.values()].sort((a, b) => b.actual - a.actual);

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
