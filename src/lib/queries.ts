import { prisma } from "@/lib/prisma";
import { computeSettlement } from "@/lib/settlement-core";
import { planBillMonth, isLumpDue, monthsUntilNextDue, type FundingStyle } from "@/lib/schedule";
import { suggestCategoryName, normalizeItem, resolveCategoryId } from "@/lib/spendCategorize";

// Keywords that drive the on-save category suggestion: the household's LEARNED words
// (SpendKeyword) plus its head-curated shortcuts (SpendShortcut, weighted high since
// they're a deliberate signal). The code seed is added client-side inside the matcher.
// Resilient to a not-yet-migrated DB (returns [] rather than throwing).
export async function getMatcherKeywords(householdId: number): Promise<{ keyword: string; category: string; hits: number }[]> {
  try {
    const [learned, shortcuts] = await Promise.all([
      prisma.spendKeyword.findMany({ where: { householdId }, select: { keyword: true, hits: true, category: { select: { name: true } } } }),
      prisma.spendShortcut.findMany({ where: { householdId, active: true }, select: { label: true, category: { select: { name: true } } } }),
    ]);
    return [
      ...learned.map((r) => ({ keyword: r.keyword, category: r.category.name, hits: r.hits })),
      ...shortcuts.map((s) => ({ keyword: normalizeItem(s.label), category: s.category.name, hits: 500 })),
    ];
  } catch {
    return [];
  }
}

// The head-curated quick chips, in display order. Resilient to a not-yet-migrated DB.
export async function getSpendShortcuts(householdId: number) {
  try {
    const rows = await prisma.spendShortcut.findMany({
      where: { householdId, active: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, icon: true, label: true, categoryId: true, category: { select: { name: true } } },
    });
    return rows.map((r) => ({ id: r.id, icon: r.icon, label: r.label, categoryId: r.categoryId, categoryName: r.category.name }));
  } catch {
    return [];
  }
}

// Fallback chips when the head hasn't curated any: the most-frequent distinct items from
// TRACKED (non-misc) history, so a tapped chip always files into the right place (never
// re-suggests Misc). Deduped by label, most-used first.
export async function getFrequentSpendItems(householdId: number, limit = 10) {
  try {
    const grouped = await prisma.spend.groupBy({
      by: ["label", "categoryId"],
      where: { category: { householdId, tracked: true, section: { not: "Misc" } } },
      _count: { _all: true },
      orderBy: { _count: { label: "desc" } },
      take: 40,
    });
    const catIds = [...new Set(grouped.map((g) => g.categoryId))];
    const cats = await prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } });
    const nameById = new Map(cats.map((c) => [c.id, c.name]));
    const seen = new Set<string>();
    const items: { icon: string | null; label: string; categoryId: number; categoryName: string }[] = [];
    for (const g of grouped) {
      const key = g.label.toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      const categoryName = nameById.get(g.categoryId);
      if (!categoryName) continue;
      seen.add(key);
      items.push({ icon: null, label: g.label, categoryId: g.categoryId, categoryName });
      if (items.length >= limit) break;
    }
    return items;
  } catch {
    return [];
  }
}

// Misc spends in this period whose item looks like it belongs in a tracked category —
// the head-only "Review Misc" safety net. Uses the same seed+learned matcher as the
// entry-time nudge, then resolves the suggestion to a real tracked (non-misc) category.
export async function getMiscReview(householdId: number, periodId: number) {
  type Item = { id: number; label: string; amount: number; who: string | null; toId: number; toName: string };
  try {
    const [miscSpends, learned, trackedCats] = await Promise.all([
      prisma.spend.findMany({
        // reviewIgnored = the head/owner said "leave it in Misc" — don't suggest it again.
        where: { periodId, reviewIgnored: false, category: { section: "Misc", tracked: true } },
        select: { id: true, label: true, amount: true, subCategory: true, member: { select: { name: true } } },
        orderBy: { id: "desc" },
      }),
      getMatcherKeywords(householdId),
      prisma.category.findMany({ where: { householdId, tracked: true, section: { not: "Misc" } }, select: { id: true, name: true } }),
    ]);
    const nameById = new Map(trackedCats.map((c) => [c.id, c.name]));

    const items: Item[] = [];
    for (const s of miscSpends) {
      // A deliberate "for someone else" tag means the person meant Misc — leave it alone.
      if (s.subCategory === "For someone else") continue;
      const name = suggestCategoryName(s.label, learned);
      const toId = resolveCategoryId(name, trackedCats); // tolerant of renamed categories
      if (toId == null) continue;
      items.push({ id: s.id, label: s.label, amount: s.amount, who: s.member?.name ?? null, toId, toName: nameById.get(toId) ?? name! });
    }
    return items;
  } catch {
    // Not-yet-migrated DB (missing SpendKeyword table or reviewIgnored column): degrade to
    // no review rather than 500-ing the Expenses page. Recovers once migrations are applied.
    return [] as Item[];
  }
}

// Bills whose set-aside was skipped for this month — shown in the sheet's "Skipped" section
// with the amount that would have been set aside (so it can be added back).
export async function getSkippedSetAsides(householdId: number, periodId: number) {
  const skips = await prisma.setAsideSkip.findMany({ where: { periodId } });
  if (skips.length === 0) return [];
  const ids = skips.map((s) => s.categoryId);
  const [cats, period, funds] = await Promise.all([
    prisma.category.findMany({ where: { id: { in: ids } } }),
    prisma.period.findUnique({ where: { id: periodId }, select: { month: true } }),
    prisma.piggyEntry.groupBy({ by: ["categoryId"], where: { householdId, kind: "sinking", categoryId: { in: ids } }, _sum: { amount: true } }),
  ]);
  const fundOf = (id: number) => funds.find((f) => f.categoryId === id)?._sum.amount ?? 0;
  const curMonth = period!.month;
  return cats
    .filter((c) => c.fundingStyle != null && c.billAmount != null && c.billMonth != null && c.billEveryMonths != null)
    .map((c) => {
      const plan = planBillMonth({
        billAmount: c.billAmount!, billMonth: c.billMonth!, everyMonths: c.billEveryMonths!,
        fund: fundOf(c.id), fundingStyle: c.fundingStyle as FundingStyle, fixedShare: c.monthlyBudget, saveEveryMonths: c.saveEveryMonths, month: curMonth,
      });
      const amount = plan.kind === "save" ? plan.contribution : 0;
      // After skipping this month's set-aside, the remaining save-months carry the same
      // target — each rises by savesLeft/(savesLeft−1). savesLeft ≤ 1 → last save → shortfall
      // lands out-of-pocket at the due month (no re-spread). Mirrors the Sheet remove dialog.
      const savesLeft = monthsUntilNextDue(c.billMonth!, c.billEveryMonths!, curMonth) / Math.max(1, c.saveEveryMonths ?? 1) + 1; // +1 = the due month's own share
      const newShare = savesLeft > 1 ? Math.round(((amount * savesLeft) / (savesLeft - 1)) * 100) / 100 : null;
      // Is the bill itself due this month or next? (current sheet is a preview of the month)
      const cyc = Math.max(1, Math.round(c.billEveryMonths!));
      const k = ((((c.billMonth! - curMonth) % cyc) + cyc) % cyc); // 0 = due this month, 1 = next
      const dueTag = k === 0 ? "this" : k === 1 ? "next" : null;
      return { categoryId: c.id, name: c.name, section: c.section, amount, newShare, dueTag };
    });
}

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

/**
 * Projected Piggy state as if `sourcePeriodId` (the current open month) were wound
 * down — powers the Piggy tab while viewing the next-month draft. Same accrual rule
 * as getWindDownPreview / windDownMonth: each budgeted non-sinking category's positive
 * remainder → General Piggy; each sinking category's (budget − spent) → its own hold.
 * Returns the getPiggyOverview shape plus a projected per-category `sinkingBalances`.
 */
export async function getProjectedPiggy(householdId: number, sourcePeriodId: number) {
  const [base, baseBalances, budgets, spends, trackedCats, billSetAsides, billPays] = await Promise.all([
    getPiggyOverview(householdId),
    getSinkingBalances(householdId),
    prisma.budget.findMany({ where: { periodId: sourcePeriodId } }),
    prisma.spend.findMany({ where: { periodId: sourcePeriodId } }),
    prisma.category.findMany({ where: { householdId, tracked: true, onHold: false } }),
    // bill-with-a-fund set-asides in the source month accrue to their fund at wind-down
    prisma.expenseEntry.findMany({ where: { periodId: sourcePeriodId, category: { fundingStyle: { not: null } }, OR: [{ label: { endsWith: "(saving)" } }, { label: { endsWith: "(monthly share)" } }] }, select: { categoryId: true, amount: true, category: { select: { name: true } } } }),
    // any due-month bill paid in the source month: the part it took from that month's set-aside
    // won't accrue (offset model), so subtract it from the projected accrual below.
    prisma.billPayment.findMany({ where: { periodId: sourcePeriodId }, select: { categoryId: true, fromSetAside: true } }),
  ]);
  const budgetOf = (c: number) => budgets.find((b) => b.categoryId === c)?.planned ?? 0;
  const spentOf = (c: number) => spends.filter((s) => s.categoryId === c).reduce((a, s) => a + s.amount, 0);

  let piggyAccrual = 0;
  const accrualByCat = new Map<number, number>();
  const nameById = new Map<number, string>();
  for (const c of trackedCats) {
    const b = budgetOf(c.id);
    if (c.sinking) {
      if (b > 0) { accrualByCat.set(c.id, b - spentOf(c.id)); nameById.set(c.id, c.name); }
    } else if (b > 0) {
      const rem = b - spentOf(c.id);
      if (rem >= 0) piggyAccrual += rem; // shortfalls carry as an expense, not out of Piggy
    }
  }

  // bill-with-a-fund categories accrue their set-aside into the same fund (projected)
  for (const e of billSetAsides) {
    if (e.categoryId == null) continue;
    accrualByCat.set(e.categoryId, (accrualByCat.get(e.categoryId) ?? 0) + e.amount);
    nameById.set(e.categoryId, e.category.name);
  }
  // …minus any part a due-month bill already consumed from that set-aside (offset model)
  for (const p of billPays) {
    if (p.fromSetAside > 0) accrualByCat.set(p.categoryId, (accrualByCat.get(p.categoryId) ?? 0) - p.fromSetAside);
  }

  // projected per-fund balances (by categoryId) for the sinking-fund list
  const sinkingBalances: Record<number, number> = { ...baseBalances };
  for (const [id, acc] of accrualByCat) sinkingBalances[id] = (sinkingBalances[id] ?? 0) + acc;

  // projected sinking list (by name, mirrors getPiggyOverview) for the header total
  const byName = new Map(base.sinking.map((s) => [s.name, { ...s }]));
  for (const [id, acc] of accrualByCat) {
    const name = nameById.get(id)!;
    const cur = byName.get(name) ?? { name, hold: 0, cycleMonths: null as number | null };
    cur.hold += acc;
    byName.set(name, cur);
  }
  const sinking = [...byName.values()].sort((a, b) => b.hold - a.hold);

  const generalTotal = base.generalTotal + piggyAccrual;
  const generalByCategory =
    piggyAccrual > 0
      ? [...base.generalByCategory, { name: "This month's estimated remainders", amount: piggyAccrual }].sort((a, b) => b.amount - a.amount)
      : base.generalByCategory;

  return { generalTotal, generalByCategory, sinking, sinkingBalances };
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

  const [members, incomes, allExpenses, spends, records] = await Promise.all([
    prisma.member.findMany({ where: { householdId }, orderBy: { id: "asc" } }),
    prisma.incomeEntry.findMany({ where: { periodId } }),
    prisma.expenseEntry.findMany({ where: { periodId }, include: { category: true }, orderBy: { id: "asc" } }),
    prisma.spend.findMany({ where: { periodId: prevPeriod?.id ?? -1 }, include: { category: true } }),
    prisma.settlementRecord.findMany({ where: { periodId } }),
  ]);
  // Exclude carried-misc lines (note "__carry__") in JS, NOT via a Prisma `not`
  // filter — Prisma's `not` also drops rows where note IS NULL (i.e. every normal
  // line), which zeroed out everyone's tagged expenses. They're tagged to the
  // spender for DISPLAY, but the credit already comes from last month's spend, so
  // counting the carried expense too would double-credit.
  // Allowances (personal money the family sends a member) are shown as their own Money-Plan
  // disbursement, so keep them OUT of the settlement net or the member would be credited twice.
  const expenses = allExpenses.filter((e) => e.note !== "__carry__" && !e.category.isAllowance);
  const prevLabel = prevPeriod?.label ?? null;

  // pure math (unit-tested in settlement-core.test.ts)
  return computeSettlement({ members, incomes, expenses, spends, records, treasurerId, prevLabel });
}

// The Money Plan for a month: the settlement transfers + dated bill payments, ordered into one
// executable checklist. Pure ordering/feasibility lives in buildMoneyPlan (unit-tested); this
// just gathers the inputs from the existing In-Hand + settlement computations (one source of truth).
export type MoneyPlanResult = Awaited<ReturnType<typeof getMoneyPlan>>;
export async function getMoneyPlan(householdId: number, periodId: number, inhandArg?: InHand) {
  const inhand = inhandArg ?? (await getInHand(householdId, periodId));
  const [settlement, incomes, period] = await Promise.all([
    getSettlement(householdId, periodId, inhand.treasurerId),
    prisma.incomeEntry.findMany({ where: { periodId }, select: { ownerId: true, dueDay: true, amount: true } }),
    prisma.period.findUnique({ where: { id: periodId }, select: { year: true, month: true, status: true } }),
  ]);

  const incomeDayByMember: Record<number, number> = {};
  const incomeByMember: Record<number, number> = {};
  for (const i of incomes) {
    if (i.ownerId == null) continue;
    incomeByMember[i.ownerId] = (incomeByMember[i.ownerId] ?? 0) + i.amount;
    if (i.dueDay == null) continue;
    incomeDayByMember[i.ownerId] = Math.min(incomeDayByMember[i.ownerId] ?? 99, i.dueDay);
  }

  // Same overdue/soon/normal test the bills use — applied to a transfer's arrival day so an inbound
  // collection that's past its income day reads as overdue too.
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayStatus = (day: number | undefined): { status: "overdue" | "soon" | "normal"; days: number } | null => {
    if (day == null || !period) return null;
    const due0 = new Date(period.year, period.month - 1, Math.min(day, new Date(period.year, period.month, 0).getDate())).getTime();
    const days = Math.round((due0 - today0) / 86400000);
    return { status: days < 0 ? "overdue" : days <= 2 ? "soon" : "normal", days };
  };

  const bills: import("./moneyPlan").PlanBill[] = [];
  for (const g of inhand.byPerson) {
    for (const b of g.unpaidBills) bills.push({ key: `bill-${b.id}`, payerId: g.memberId, payerName: g.name, vendor: b.name, amount: b.amount, done: false, day: b.due?.day ?? null, status: b.due?.status ?? null, days: b.due?.days ?? null, billId: b.id });
    for (const b of g.paidBills) bills.push({ key: `bill-${b.id}`, payerId: g.memberId, payerName: g.name, vendor: b.name, amount: b.amount, done: true, day: b.due?.day ?? null, status: b.due?.status ?? null, days: b.due?.days ?? null, billId: b.id });
    for (const p of g.unpaidPeriodic) bills.push({ key: `fund-${p.categoryId}`, payerId: g.memberId, payerName: g.name, vendor: p.name, amount: p.bill, done: false, day: p.due?.day ?? null, status: p.due?.status ?? null, days: p.due?.days ?? null, categoryId: p.categoryId, fund: true, fundAvail: p.fund });
    for (const p of g.paidPeriodic) bills.push({ key: `fund-${p.categoryId}`, payerId: g.memberId, payerName: g.name, vendor: p.name, amount: p.bill, done: true, day: p.due?.day ?? null, status: p.due?.status ?? null, days: p.due?.days ?? null, categoryId: p.categoryId, fund: true, fundAvail: p.fund });
  }
  // Shared (no-payer) bills — e.g. an expense added from the plan with payer "Shared" — are paid from
  // the pool, so the treasurer covers them. Without this they'd land on the Sheet but never show as a step.
  const treasurerName = settlement.treasurer?.name ?? "Treasurer";
  for (const b of inhand.shared.unpaidBills) bills.push({ key: `bill-${b.id}`, payerId: inhand.treasurerId, payerName: treasurerName, vendor: b.name, amount: b.amount, done: false, day: b.due?.day ?? null, status: b.due?.status ?? null, days: b.due?.days ?? null, billId: b.id });
  for (const b of inhand.shared.paidBills) bills.push({ key: `bill-${b.id}`, payerId: inhand.treasurerId, payerName: treasurerName, vendor: b.name, amount: b.amount, done: true, day: b.due?.day ?? null, status: b.due?.status ?? null, days: b.due?.days ?? null, billId: b.id });

  const transfers = settlement.transfers.map((t) => {
    // inbound (to the treasurer): urgency from the payer's income arrival day
    const st = t.toId === inhand.treasurerId ? dayStatus(incomeDayByMember[t.fromId]) : null;
    return { fromId: t.fromId, from: t.from, toId: t.toId, to: t.to, amount: t.amount, settled: t.settled, recordId: t.recordId, status: st?.status ?? null, days: st?.days ?? null };
  });

  const allowances = inhand.allowances.map((a) => ({ key: `allow-${a.id}`, recipientId: a.recipientId, recipientName: a.recipientName, amount: a.amount, done: a.done, billId: a.id }));

  // Piggy returns (open month only): each budget holder who isn't the Piggy holder hands their GROSS
  // positive budget leftovers (Σ max(0, remaining) — over-budget categories don't reduce it, matching
  // how the Piggy is booked) to the Piggy holder, so the general Piggy ends up under one person.
  const piggyHolderId = inhand.piggyHolderId;
  const piggyHolderName = inhand.byPerson.find((g) => g.memberId === piggyHolderId)?.name ?? "Piggy holder";
  const piggyReturns =
    period?.status === "open" && piggyHolderId != null
      ? inhand.byPerson
          .filter((g) => g.memberId != null && g.memberId !== piggyHolderId)
          .map((g) => ({ fromId: g.memberId as number, fromName: g.name, amount: Math.round(g.cats.reduce((s, c) => s + Math.max(0, c.remaining), 0) * 100) / 100 }))
          .filter((x) => x.amount > 0.005)
          .map((x) => ({ key: `piggy-${x.fromId}`, fromId: x.fromId, fromName: x.fromName, toId: piggyHolderId, toName: piggyHolderName, amount: x.amount }))
      : [];

  const { buildMoneyPlan } = await import("./moneyPlan");
  return { ...buildMoneyPlan({ treasurerId: inhand.treasurerId, treasurerName: settlement.treasurer?.name, transfers, bills, allowances, piggyReturns, incomeDayByMember, incomeByMember }), treasurerId: inhand.treasurerId, periodId };
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
      section: cat.section, // "Misc" (+ tracked) marks the Personal/Misc bucket
      allocation,
      spent,
      remaining: allocation - spent,
      overBudget: allocation > 0 && spent > allocation,
      sinking: cat.sinking,
      responsibleMemberId: cat.responsibleMemberId, // who holds this budget (null = shared)
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
 *   net = (budgeted categories still unspent) + (tagged bills still to pay)
 *         − (their misc/unbudgeted spend).
 * "Bills" = every tagged non-tracked expense line they were handed money to pay
 * — loans, chits, interest, fixed bills, plain "pay someone" (cook, milk). Each
 * can be marked paid (drops out of the net into a "paid this month" list). A
 * positive net = cash they're still holding; negative = they fronted more than
 * they hold → reclaim from the treasurer, or deduct next month. Additionally:
 * the treasurer's row carries the family pool (shared net + month's income −
 * expense balance); the piggy-holder's row carries the Piggy bank. Both roles
 * default to the head and always appear even with no personal in-hand.
 */
export async function getInHand(householdId: number, periodId: number) {
  const [household, period, categories, budgets, spends, billLines, miscLines, fundLines, fundCats, sinkBal, billPayments, members, piggy, incomeAgg, expenseAgg, carriedRaw, closedPeriods, allPays, allowanceLines, sinkCats] = await Promise.all([
    prisma.household.findUnique({ where: { id: householdId }, select: { treasurerMemberId: true, piggyHolderMemberId: true } }),
    prisma.period.findUnique({ where: { id: periodId }, select: { treasurerMemberId: true, status: true, month: true, year: true } }),
    prisma.category.findMany({ where: { householdId, tracked: true, onHold: false } }),
    prisma.budget.findMany({ where: { periodId } }),
    prisma.spend.findMany({ where: { periodId } }),
    // "bills" = tagged Sheet expense lines the person was handed money to pay: loans, chits,
    // interest, fixed bills, plain "pay someone" (cook, milk…), AND hand-added Misc lines
    // (tracked:false). Each shows with a "paid" toggle. Excludes tracked-budget lines
    // (handled via budgets), goal-based bill funds (fundingStyle) and carried misc (note set).
    prisma.expenseEntry.findMany({ where: { periodId, note: null, category: { tracked: false, fundingStyle: null, isAllowance: false } }, include: { category: { select: { section: true } } } }),
    // Preview/draft ONLY: own-period misc Sheet lines (Misc section, no carry marker),
    // subtracted as an estimated lump — a draft can't log Spends or mark bills paid, so misc
    // is just a planned reduction. In an OPEN/closed month these same lines instead ride in
    // `billLines` above (with a paid toggle), so we do NOT lump them there. Carried misc
    // (note "__carry__") stays excluded either way — settled at month start, not held cash.
    prisma.expenseEntry.findMany({ where: { periodId, note: null, category: { section: "Misc" } }, select: { amount: true, memberId: true } }),
    // Bill-with-a-fund lines: the "(saving)" set-aside (tagged to the SAVER — held/earmarked),
    // the due-month full bill and its "— from fund" credit (tagged to the PAYER — net out-of-pocket).
    prisma.expenseEntry.findMany({ where: { periodId, note: null, category: { fundingStyle: { not: null } } }, select: { id: true, label: true, amount: true, memberId: true, paid: true, categoryId: true, category: { select: { name: true } } } }),
    // bill-with-a-fund categories (config) — for the misc exclusion AND to synthesize the
    // due-month "to pay" bill (auto bills don't put the bill on the Sheet anymore).
    prisma.category.findMany({ where: { householdId, fundingStyle: { not: null }, onHold: false }, select: { id: true, name: true, fundingStyle: true, billAmount: true, billMonth: true, billDay: true, billEveryMonths: true, responsibleMemberId: true, payerMemberId: true, onUnpaid: true } }),
    getSinkingBalances(householdId),
    prisma.billPayment.findMany({ where: { periodId }, select: { categoryId: true, memberId: true, fromSetAside: true } }),
    prisma.member.findMany({ where: { householdId }, orderBy: { id: "asc" } }),
    getPiggyOverview(householdId),
    prisma.incomeEntry.aggregate({ where: { periodId }, _sum: { amount: true } }),
    prisma.expenseEntry.aggregate({ where: { periodId }, _sum: { amount: true } }),
    // Carried-over unpaid bills: regular (non-fund) bill lines from earlier CLOSED months that
    // were never marked paid. They're already accounted in that month's settlement, so they ride
    // in the current In-Hand purely as a "you still haven't paid the vendor" nag — net-neutral,
    // never added to the total, cleared by ticking ✓ paid (which flips that old entry).
    prisma.expenseEntry.findMany({
      where: { note: null, paid: false, category: { tracked: false, fundingStyle: null }, period: { householdId, status: "closed" } },
      select: { id: true, label: true, amount: true, memberId: true, period: { select: { year: true, month: true, label: true } } },
    }),
    // All closed months + every bill-payment record — to find periodic fund-bills that were DUE
    // in a closed month and never paid (carried, still owed to the vendor).
    prisma.period.findMany({ where: { householdId, status: "closed" }, select: { id: true, year: true, month: true, label: true } }),
    prisma.billPayment.findMany({ where: { householdId }, select: { categoryId: true, periodId: true } }),
    // Allowances: fixed monthly personal money the family SENDS a member (category.isAllowance).
    // Not a bill they owe — surfaced separately as a "Send ₹X to <member>" disbursement in the
    // Money Plan, and taken OUT of the settlement blob so it isn't double-counted.
    prisma.expenseEntry.findMany({ where: { periodId, note: null, category: { isAllowance: true } }, select: { id: true, label: true, amount: true, memberId: true, paid: true } }),
    // Sinking-fund categories + their SAVER (responsible member), so each accrued fund hold is shown
    // under the person who actually holds it — separate from the general Piggy holder.
    prisma.category.findMany({ where: { householdId, OR: [{ sinking: true }, { fundingStyle: { not: null } }] }, select: { id: true, name: true, responsibleMemberId: true } }),
  ]);
  const isDraft = period?.status === "draft";
  // In a draft, Misc lines are a lump estimate (below), so keep them OUT of the bill list.
  // In an open/closed month, Misc lines stay in the bill list (paid-toggleable), as before.
  const bills = isDraft ? billLines.filter((e) => e.category.section !== "Misc") : billLines;

  const plannedByCat = new Map(budgets.map((b) => [b.categoryId, b.planned]));
  const budgetedIds = new Set(categories.filter((c) => (plannedByCat.get(c.id) ?? 0) > 0).map((c) => c.id));
  const catHolder = new Map(categories.map((c) => [c.id, c.responsibleMemberId ?? null]));

  // Split each budgeted-category spend by WHO actually spent it:
  //  • the category's holder (or an UNTAGGED spend) → counts against the holder's held budget,
  //    reducing that category's remaining, as before;
  //  • anyone else → the cash came out of THEIR pocket, so it drops off the holder's line and
  //    instead subtracts from the spender's in-hand (folded into their misc line below). This is
  //    the same spender-vs-holder rule the settlement uses, so In-Hand and Settlement agree.
  const heldSpentByCat = new Map<number, number>();
  const outOfPocketByMember = new Map<number | null, number>();
  for (const s of spends) {
    if (!budgetedIds.has(s.categoryId)) continue;
    const holder = catHolder.get(s.categoryId) ?? null;
    const spender = s.memberId ?? null;
    if (spender != null && spender !== holder) {
      outOfPocketByMember.set(spender, (outOfPocketByMember.get(spender) ?? 0) + s.amount);
    } else {
      heldSpentByCat.set(s.categoryId, (heldSpentByCat.get(s.categoryId) ?? 0) + s.amount);
    }
  }

  // budgeted category rows (by responsible member) — `spent` is the holder's own + untagged only
  const rows = categories
    .filter((c) => budgetedIds.has(c.id))
    .map((cat) => ({
      id: cat.id,
      name: cat.name,
      responsibleMemberId: cat.responsibleMemberId,
      allocation: plannedByCat.get(cat.id) ?? 0,
      spent: heldSpentByCat.get(cat.id) ?? 0,
      remaining: (plannedByCat.get(cat.id) ?? 0) - (heldSpentByCat.get(cat.id) ?? 0),
    }));

  // misc / unbudgeted spend (by whoever logged it) — already spent, subtracts from in-hand.
  const fundCatIds = new Set(fundCats.map((c) => c.id)); // bill-with-fund categories
  const miscByMember = new Map<number | null, number>();
  for (const s of spends) {
    if (budgetedIds.has(s.categoryId)) continue;
    if (fundCatIds.has(s.categoryId)) continue; // a spend against a bill's fund isn't misc (it draws the fund)
    const k = s.memberId ?? null;
    miscByMember.set(k, (miscByMember.get(k) ?? 0) + s.amount);
  }
  // Draft/preview only: planned Misc Sheet lines subtract as an estimated lump (no Spends,
  // no paid toggle yet). Open/closed months show these as paid-toggleable bills instead.
  if (isDraft) {
    for (const e of miscLines) {
      const k = e.memberId ?? null;
      miscByMember.set(k, (miscByMember.get(k) ?? 0) + e.amount);
    }
  }
  // Spends on someone else's budgeted category came out of the spender's pocket — lump them into
  // the same misc subtraction (they're already off the holder's remaining, above).
  for (const [k, v] of outOfPocketByMember) miscByMember.set(k, (miscByMember.get(k) ?? 0) + v);

  // Set-asides = held/earmarked cash for the SAVER (from the Sheet "(saving)"/"(monthly share)"
  // lines — the latter appear in older sinking-fund months still frozen in their open month).
  const isSaveLine = (lbl: string) => lbl.endsWith("(saving)") || lbl.endsWith("(monthly share)");
  const savingLines = fundLines.filter((e) => isSaveLine(e.label));

  // Due-month periodic bills to pay — synthesized from config (auto bills no longer put the bill
  // on the Sheet). Tagged to the PAYER; net-neutral in-hand (paid from the fund/Piggy in the pay
  // modal, any out-of-pocket becomes a Misc Spend then). "Pay in full" bills stay a Sheet expense.
  // Fund available to pay a due-month bill = the ACCRUED sinking balance PLUS this month's own
  // set-aside (not yet accrued until wind-down). The due month's share is allowed to go toward
  // the bill, so it counts as available now (paying draws it; wind-down accrual reconciles).
  const pendingByCat = new Map<number, number>();
  for (const e of savingLines) pendingByCat.set(e.categoryId, (pendingByCat.get(e.categoryId) ?? 0) + e.amount);

  // For a NEXT-month DRAFT, the fund a due bill can count on also includes the current open
  // month's set-aside — it accrues into the fund when that month winds down. A draft isn't
  // payable yet, so we surface this as a projected fund ("₹X after <month> winds down"). In a
  // real open month there's no prior open period, so this term is 0 and nothing changes.
  const priorOpen = await prisma.period.findMany({ where: { householdId, status: "open", id: { not: periodId } }, select: { id: true, label: true } });
  const projectedByCat = new Map<number, number>();
  let projectionLabel: string | null = null;
  if (priorOpen.length > 0) {
    const priorIds = priorOpen.map((p) => p.id);
    const [priorSaves, priorPays] = await Promise.all([
      prisma.expenseEntry.findMany({ where: { periodId: { in: priorIds }, category: { fundingStyle: { not: null } }, OR: [{ label: { endsWith: "(saving)" } }, { label: { endsWith: "(monthly share)" } }] }, select: { categoryId: true, amount: true } }),
      prisma.billPayment.findMany({ where: { periodId: { in: priorIds } }, select: { categoryId: true, fromSetAside: true } }),
    ]);
    for (const e of priorSaves) if (e.categoryId != null) projectedByCat.set(e.categoryId, (projectedByCat.get(e.categoryId) ?? 0) + e.amount);
    for (const p of priorPays) projectedByCat.set(p.categoryId, (projectedByCat.get(p.categoryId) ?? 0) - p.fromSetAside);
    projectionLabel = priorOpen.length === 1 ? priorOpen[0].label : "wind-down";
  }

  // Carried unpaid bills only make sense in the live (open/draft) month, and only for months
  // strictly BEFORE it — so a closed month you're browsing doesn't show later months' nags.
  const curY = period?.year ?? 0;
  const curM = period?.month ?? 0;
  const carriedBills =
    period?.status === "closed"
      ? []
      : carriedRaw.filter((e) => e.period.year < curY || (e.period.year === curY && e.period.month < curM));

  // Carried periodic fund-bills: a "carry"-mode auto bill that was DUE in an earlier closed month
  // and never paid. Money's safe in the fund; this surfaces it so a multi-month bill's miss isn't
  // silent. Paying it (from the band) records against that closed month, drawing the fund now.
  const paidSet = new Set(allPays.map((p) => `${p.categoryId}:${p.periodId}`));
  const priorClosed =
    period?.status === "closed" ? [] : closedPeriods.filter((p) => p.year < curY || (p.year === curY && p.month < curM));
  const carriedPeriodic =
    period?.status === "closed"
      ? []
      : fundCats
          .filter((c) => c.fundingStyle === "auto" && (c.onUnpaid ?? "carry") === "carry" && c.billAmount != null && c.billAmount > 0 && c.billMonth != null && c.billEveryMonths != null)
          .flatMap((c) =>
            priorClosed
              .filter((p) => isLumpDue(c.billMonth!, c.billEveryMonths!, { month: p.month }) && !paidSet.has(`${c.id}:${p.id}`))
              .map((p) => ({
                categoryId: c.id,
                name: c.name,
                bill: c.billAmount!,
                payer: c.payerMemberId ?? c.responsibleMemberId ?? null,
                fund: Math.round((sinkBal[c.id] ?? 0) * 100) / 100,
                fromMonth: p.label,
                periodId: p.id,
              })),
          );

  const paidCats = new Map(billPayments.map((p) => [p.categoryId, p]));
  // How much of each category's set-aside a due-month bill already consumed this period.
  const consumedByCat = new Map<number, number>();
  for (const p of billPayments) if (p.fromSetAside > 0) consumedByCat.set(p.categoryId, (consumedByCat.get(p.categoryId) ?? 0) + p.fromSetAside);
  const dueBills = fundCats
    .filter((c) => c.fundingStyle === "auto" && c.billAmount != null && c.billAmount > 0 && c.billMonth != null && c.billEveryMonths != null && isLumpDue(c.billMonth, c.billEveryMonths, { month: period?.month ?? 0 }))
    .map((c) => {
      const projected = Math.max(0, Math.round((projectedByCat.get(c.id) ?? 0) * 100) / 100);
      const fund = Math.round(((sinkBal[c.id] ?? 0) + (pendingByCat.get(c.id) ?? 0) + projected) * 100) / 100;
      return { categoryId: c.id, name: c.name, bill: c.billAmount!, payer: c.payerMemberId ?? c.responsibleMemberId ?? null, fund, afterWindDown: projected > 0 ? projectionLabel : null, paid: paidCats.has(c.id), day: c.billDay ?? null };
    });

  // Due-date status for a bill line, evaluated against today for THIS period's month. `overdue`
  // = due date has passed & still unpaid; `soon` = due within 2 days; `normal` = dated but not
  // urgent; null = no date set (render plain, per "no due date → show as normal").
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueOf = (dueDay: number | null | undefined) => {
    if (!dueDay || !period) return null;
    const lastDay = new Date(period.year, period.month, 0).getDate();
    const day = Math.min(Math.max(dueDay, 1), lastDay);
    const due0 = new Date(period.year, period.month - 1, day).getTime();
    const days = Math.round((due0 - today0) / 86400000);
    const status = days < 0 ? "overdue" : days <= 2 ? "soon" : "normal";
    return { day: dueDay, days, status } as const;
  };
  const billRank = (d: { status: string } | null) => (d?.status === "overdue" ? 0 : d?.status === "soon" ? 1 : 2);

  const build = (key: number | null, name: string) => {
    const cats = rows.filter((r) => (r.responsibleMemberId ?? null) === key);
    const memberBills = bills
      .filter((e) => (e.memberId ?? null) === key)
      .map((e) => ({ id: e.id, name: e.label, amount: e.amount, paid: e.paid, due: dueOf(e.dueDay) }));
    // urgent (overdue → soon) bills float to the top of the unpaid list
    const unpaidBills = memberBills.filter((b) => !b.paid).sort((a, b) => billRank(a.due) - billRank(b.due));
    const paidBills = memberBills.filter((b) => b.paid);
    // set-asides this member is holding toward a bill (saver) — but once a due-month bill was
    // PAID from this month's share (BillPayment.fromSetAside), that cash has left their hand and
    // gone to the bill, so drop it from "held" (else it double-counts in the in-hand total).
    const earmarked = savingLines
      .filter((e) => (e.memberId ?? null) === key)
      .map((e) => ({ id: e.id, name: e.category.name, amount: Math.round((e.amount - (consumedByCat.get(e.categoryId) ?? 0)) * 100) / 100 }))
      .filter((e) => e.amount > 0.005);
    // due-month periodic bills this member pays (net-neutral; paid from fund/Piggy in the modal)
    const memberDue = dueBills.filter((b) => b.payer === key);
    const unpaidPeriodic = memberDue.filter((b) => !b.paid).map((b) => ({ categoryId: b.categoryId, name: b.name, bill: b.bill, fund: b.fund, afterWindDown: b.afterWindDown, due: dueOf(b.day) }));
    const paidPeriodic = memberDue.filter((b) => b.paid).map((b) => ({ categoryId: b.categoryId, name: b.name, bill: b.bill, fund: b.fund, afterWindDown: b.afterWindDown, due: dueOf(b.day) }));

    // bills carried over from an earlier closed month, still not marked paid (net-neutral nag)
    const carried = carriedBills
      .filter((e) => (e.memberId ?? null) === key)
      .map((e) => ({ id: e.id, name: e.label, amount: e.amount, from: e.period.label }));
    // periodic fund-bills this member pays that were due in a closed month and never paid
    const carriedDue = carriedPeriodic
      .filter((b) => b.payer === key)
      .map((b) => ({ categoryId: b.categoryId, name: b.name, bill: b.bill, fund: b.fund, fromMonth: b.fromMonth, periodId: b.periodId }));

    // Accrued sinking-fund holds this person is the SAVER of — held separately from the general
    // Piggy (which sits with the Piggy holder). Shown as its own "held for the bill" line.
    const sinkingFunds = sinkCats
      .filter((c) => (c.responsibleMemberId ?? piggyHolderId) === key)
      .map((c) => ({ name: c.name, amount: Math.round((sinkBal[c.id] ?? 0) * 100) / 100 }))
      .filter((f) => Math.abs(f.amount) > 0.005);
    const sinkingHeld = sinkingFunds.reduce((s, f) => s + f.amount, 0);

    const budgetRemaining = cats.reduce((s, r) => s + r.remaining, 0);
    const unpaidTotal = unpaidBills.reduce((s, b) => s + b.amount, 0);
    const earmarkedTotal = earmarked.reduce((s, e) => s + e.amount, 0);
    const miscSpent = miscByMember.get(key) ?? 0;
    return {
      memberId: key, name, cats, unpaidBills, paidBills, earmarked, unpaidPeriodic, paidPeriodic, carried, carriedDue,
      sinkingFunds, sinkingHeld,
      budgetRemaining, unpaidTotal, earmarkedTotal, miscSpent,
      // carried bills are NOT in `net` — they were already settled in their own month.
      net: budgetRemaining + unpaidTotal + earmarkedTotal - miscSpent,
    };
  };

  const headId = members.find((m) => m.role === "head")?.id ?? null;
  const treasurerId = period?.treasurerMemberId ?? household?.treasurerMemberId ?? headId;
  const piggyHolderId = household?.piggyHolderMemberId ?? headId;

  // keep a member if they hold anything — OR they're the treasurer/piggy-holder (so their
  // pool/piggy row always shows, even with no personal in-hand).
  const byPerson = members
    .map((m) => build(m.id, m.name))
    .filter((g) => g.cats.length > 0 || g.miscSpent > 0 || g.unpaidBills.length > 0 || g.paidBills.length > 0 || g.earmarked.length > 0 || g.sinkingFunds.length > 0 || g.unpaidPeriodic.length > 0 || g.paidPeriodic.length > 0 || g.carried.length > 0 || g.carriedDue.length > 0 || g.memberId === treasurerId || g.memberId === piggyHolderId);
  const shared = build(null, "Shared / pool");
  const piggyTotal = piggy.generalTotal + piggy.sinking.reduce((s, x) => s + x.hold, 0);
  const monthBalance = (incomeAgg._sum.amount ?? 0) - (expenseAgg._sum.amount ?? 0);
  // the treasurer additionally holds the family pool: shared in-hand + the month's balance
  const treasurerPool = shared.net + monthBalance;

  // Allowances to send this month (treasurer → member). `done` = the Sheet line's paid flag.
  const nameOf = (id: number | null) => members.find((m) => m.id === id)?.name ?? "member";
  const allowances = allowanceLines
    .filter((e) => e.memberId != null)
    .map((e) => ({ id: e.id, recipientId: e.memberId as number, recipientName: nameOf(e.memberId), amount: e.amount, done: e.paid }));

  return { byPerson, shared, allowances, piggyTotal, generalPiggy: piggy.generalTotal, treasurerId, piggyHolderId, monthBalance, treasurerPool };
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

  // The Personal/Misc bucket (tracked, section "Misc") is expanded into its spend
  // sub-categories (Food, Travel…) so the breakdown shows where misc money actually
  // went. Totals are unchanged — the single "Personal/Misc" row is just split out.
  const miscCat = cats.find((c) => c.section === "Misc" && c.tracked);
  const byCategory = cats
    .flatMap((cat) => {
      const planned = plannedByCat.get(cat.id) ?? 0;
      const actual = cat.tracked ? spendByCat.get(cat.id) ?? 0 : expenseByCat.get(cat.id) ?? 0;
      if (miscCat && cat.id === miscCat.id) {
        const bySub = new Map<string, number>();
        for (const s of spends) {
          if (s.categoryId !== cat.id) continue;
          const key = s.subCategory ?? "Uncategorized";
          bySub.set(key, (bySub.get(key) ?? 0) + s.amount);
        }
        return [...bySub.entries()].map(([sub, amt]) => ({ name: `Misc · ${sub}`, planned: 0, actual: amt }));
      }
      return [{ name: cat.name, planned, actual }];
    })
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

// Per-category month-by-month "budgeted vs spent" across a range — powers the Analysis
// range view's per-category chart (shown when the month-trend chart can't be). Same
// actual rule as getRollup (tracked → daily Spend total, else sheet ExpenseEntry).
export async function getCategoryTrendRange(
  householdId: number,
  fromY: number,
  fromM: number,
  toY: number,
  toM: number,
) {
  const lo = fromY * 12 + (fromM - 1);
  const hi = toY * 12 + (toM - 1);
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];

  const allPeriods = await prisma.period.findMany({ where: { householdId } });
  const periods = allPeriods
    .filter((p) => {
      const k = p.year * 12 + (p.month - 1);
      return k >= a && k <= b;
    })
    .sort((x, y) => x.year * 12 + x.month - (y.year * 12 + y.month));
  if (periods.length === 0) return { months: [], categories: [] };

  const ids = periods.map((p) => p.id);
  const [cats, budgets, spends, expenses] = await Promise.all([
    prisma.category.findMany({ where: { householdId } }),
    prisma.budget.findMany({ where: { periodId: { in: ids } } }),
    prisma.spend.findMany({ where: { periodId: { in: ids } } }),
    prisma.expenseEntry.findMany({ where: { periodId: { in: ids } } }),
  ]);
  const monthIndex = new Map(periods.map((p, i) => [p.id, i]));
  const months = periods.map((p) => p.label);
  const catById = new Map(cats.map((c) => [c.id, c]));

  const acc = new Map<number, { planned: number[]; spent: number[] }>();
  const ensure = (cid: number) => {
    let v = acc.get(cid);
    if (!v) {
      v = { planned: Array(periods.length).fill(0), spent: Array(periods.length).fill(0) };
      acc.set(cid, v);
    }
    return v;
  };
  for (const bd of budgets) {
    const i = monthIndex.get(bd.periodId);
    if (i != null) ensure(bd.categoryId).planned[i] += bd.planned;
  }
  for (const s of spends) {
    const i = monthIndex.get(s.periodId);
    if (i != null && catById.get(s.categoryId)?.tracked) ensure(s.categoryId).spent[i] += s.amount;
  }
  for (const e of expenses) {
    const i = monthIndex.get(e.periodId);
    if (i != null && !catById.get(e.categoryId)?.tracked) ensure(e.categoryId).spent[i] += e.amount;
  }

  const categories = [...acc.entries()]
    .map(([id, v]) => ({
      id,
      name: catById.get(id)?.name ?? "?",
      planned: v.planned,
      spent: v.spent,
      totalPlanned: v.planned.reduce((s, x) => s + x, 0),
      totalSpent: v.spent.reduce((s, x) => s + x, 0),
    }))
    .filter((c) => c.totalPlanned > 0) // "budgeted" categories only
    .sort((a, b) => b.totalSpent - a.totalSpent);

  return { months, categories };
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
// Match key that ignores a trailing installment counter (" 2/6", " 3/6") so a recurring
// EMI/chit is recognised as the SAME line across months instead of an add + a remove.
// Also folds the two set-aside label variants together for the same reason.
function diffKey(label: string): string {
  return label
    .replace(/\s*\d+\s*\/\s*\d+\s*$/, "") // installment counter "N/M"
    .replace(/\((?:saving|monthly share)\)$/, "(share)") // set-aside variants
    .trim();
}

function diffByKey(
  cur: { label: string; amount: number }[],
  prev: { label: string; amount: number }[],
) {
  const roll = (rows: { label: string; amount: number }[]) => {
    // key → { amount, label } — label keeps the latest human-readable text for that key.
    const m = new Map<string, { amount: number; label: string }>();
    for (const r of rows) {
      const k = diffKey(r.label);
      const prev = m.get(k);
      m.set(k, { amount: (prev?.amount ?? 0) + r.amount, label: r.label });
    }
    return m;
  };
  const c = roll(cur);
  const p = roll(prev);
  const added: { label: string; amount: number }[] = [];
  const removed: { label: string; amount: number }[] = [];
  const changed: { label: string; from: number; to: number }[] = [];
  for (const [key, v] of c) {
    if (!p.has(key)) added.push({ label: v.label, amount: v.amount });
    else if (Math.abs((p.get(key)!.amount) - v.amount) >= 0.5)
      changed.push({ label: v.label, from: p.get(key)!.amount, to: v.amount });
  }
  for (const [key, v] of p) if (!c.has(key)) removed.push({ label: v.label, amount: v.amount });
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
    curInc.map((i) => ({ label: i.source, amount: i.amount })),
    prevInc.map((i) => ({ label: i.source, amount: i.amount })),
  );
  // Misc is one-off and churns every month, so it gets its own block rather than
  // flooding the main expense diff.
  const expense = diffByKey(
    curExp.filter((e) => !isMisc(e)).map((e) => ({ label: e.label, amount: e.amount })),
    prevExp.filter((e) => !isMisc(e)).map((e) => ({ label: e.label, amount: e.amount })),
  );
  const misc = diffByKey(
    curExp.filter(isMisc).map((e) => ({ label: e.label, amount: e.amount })),
    prevExp.filter(isMisc).map((e) => ({ label: e.label, amount: e.amount })),
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
