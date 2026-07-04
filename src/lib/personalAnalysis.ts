import { prisma } from "@/lib/prisma";

export type Bucket = "need" | "want" | "invest";
export const BUCKET_TARGET: Record<Bucket, number> = { need: 50, want: 30, invest: 20 };

/**
 * Personal spending analysis: the 50/30/20 split for the selected month, plus
 * range metrics (income / spent / saved over the last N months) and a trend.
 * `rangeMonths` = 3 | 6 | 12 | null(all).
 */
export async function getPersonalAnalysis(memberId: number, periodId: number, rangeMonths: number | null = 6) {
  const [periods, cats, exps, spends, extraByPeriod] = await Promise.all([
    prisma.personalPeriod.findMany({ where: { memberId }, orderBy: [{ year: "asc" }, { month: "asc" }] }),
    prisma.personalCategory.findMany({ where: { memberId } }),
    prisma.personalExpense.findMany({ where: { memberId }, select: { periodId: true, categoryId: true, amount: true } }),
    prisma.personalSpend.findMany({ where: { memberId }, select: { periodId: true, categoryId: true, amount: true } }),
    prisma.personalIncome.groupBy({ by: ["periodId"], where: { memberId }, _sum: { amount: true } }),
  ]);

  const bucketOf = new Map(cats.map((c) => [c.id, (c.bucket as Bucket) ?? "want"]));
  const catOf = new Map(cats.map((c) => [c.id, c]));
  const extraOf = new Map(extraByPeriod.map((e) => [e.periodId, e._sum.amount ?? 0]));
  const all = [...exps, ...spends];

  // per-period expense & spend sums
  const expByPeriod = new Map<number, number>();
  for (const e of exps) expByPeriod.set(e.periodId, (expByPeriod.get(e.periodId) ?? 0) + e.amount);
  const spdByPeriod = new Map<number, number>();
  for (const s of spends) spdByPeriod.set(s.periodId, (spdByPeriod.get(s.periodId) ?? 0) + s.amount);

  const monthly = periods.map((p) => {
    const rows = all.filter((r) => r.periodId === p.id);
    const b = { need: 0, want: 0, invest: 0 };
    for (const r of rows) b[bucketOf.get(r.categoryId ?? -1) ?? "want"] += r.amount;
    return { periodId: p.id, label: p.label, ...b, total: b.need + b.want + b.invest };
  });

  // ── selected-month 50/30/20 rule ──
  const period = periods.find((p) => p.id === periodId);
  const sel = monthly.find((m) => m.periodId === periodId) ?? { need: 0, want: 0, invest: 0, total: 0 };
  const income = period ? period.income + period.carryForward + (extraOf.get(period.id) ?? 0) : 0;
  const base = income > 0 ? income : sel.total || 1;
  const rule = {
    income,
    basis: income > 0 ? ("income" as const) : ("spend" as const),
    need: { amount: sel.need, pct: (sel.need / base) * 100, target: 50 },
    want: { amount: sel.want, pct: (sel.want / base) * 100, target: 30 },
    invest: { amount: sel.invest, pct: (sel.invest / base) * 100, target: 20 },
  };

  // ── range window (most recent N periods, oldest → newest) ──
  const window = rangeMonths ? periods.slice(-rangeMonths) : periods;
  const rangeIds = new Set(window.map((p) => p.id));
  const series = window.map((p) => {
    const inc = p.income + (extraOf.get(p.id) ?? 0); // salary + extras (carry excluded — it's last month's leftover)
    const out = (expByPeriod.get(p.id) ?? 0) + (spdByPeriod.get(p.id) ?? 0);
    return { label: p.label, income: Math.round(inc), expense: Math.round(out), balance: Math.round(inc - out) };
  });
  const rIncome = series.reduce((s, x) => s + x.income, 0);
  const rExpenses = window.reduce((s, p) => s + (expByPeriod.get(p.id) ?? 0), 0);
  const rSpends = window.reduce((s, p) => s + (spdByPeriod.get(p.id) ?? 0), 0);
  const rOut = rExpenses + rSpends;
  const mo = Math.max(1, window.length);
  const range = {
    months: window.length,
    income: rIncome,
    expenses: rExpenses,
    spends: rSpends,
    out: rOut,
    saved: rIncome - rOut,
    avgOut: rOut / mo,
    savingRate: rIncome > 0 ? ((rIncome - rOut) / rIncome) * 100 : 0,
    series,
  };

  // ── top categories over the range ──
  const catTotals = new Map<number, number>();
  for (const r of all.filter((x) => rangeIds.has(x.periodId) && x.categoryId != null))
    catTotals.set(r.categoryId!, (catTotals.get(r.categoryId!) ?? 0) + r.amount);
  const topCategories = [...catTotals.entries()]
    .map(([id, total]) => ({ cat: catOf.get(id), total }))
    .filter((x) => x.cat)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((x) => ({ name: x.cat!.name, icon: x.cat!.icon, bucket: (x.cat!.bucket as Bucket) ?? "want", total: x.total }));

  return { monthly: monthly.slice(-18), rule, range, topCategories, hasData: all.length > 0 };
}
