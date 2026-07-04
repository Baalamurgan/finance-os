import { prisma } from "@/lib/prisma";

export type Bucket = "need" | "want" | "invest";
export const BUCKET_TARGET: Record<Bucket, number> = { need: 50, want: 30, invest: 20 };

/**
 * Personal spending analysis: the 50/30/20 split for the selected month plus a
 * month-by-month trend and this month's top categories. Combines fixed monthly
 * expenses + daily spends, grouped by each category's bucket.
 */
export async function getPersonalAnalysis(memberId: number, periodId: number) {
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

  const monthly = periods.map((p) => {
    const rows = all.filter((r) => r.periodId === p.id);
    const b = { need: 0, want: 0, invest: 0 };
    for (const r of rows) b[bucketOf.get(r.categoryId ?? -1) ?? "want"] += r.amount;
    return { periodId: p.id, label: p.label, ...b, total: b.need + b.want + b.invest };
  });

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

  // this month's top categories
  const catTotals = new Map<number, number>();
  for (const r of all.filter((x) => x.periodId === periodId && x.categoryId != null))
    catTotals.set(r.categoryId!, (catTotals.get(r.categoryId!) ?? 0) + r.amount);
  const topCategories = [...catTotals.entries()]
    .map(([id, total]) => ({ cat: catOf.get(id), total }))
    .filter((x) => x.cat)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((x) => ({ name: x.cat!.name, icon: x.cat!.icon, bucket: (x.cat!.bucket as Bucket) ?? "want", total: x.total }));

  return { monthly: monthly.slice(-18), rule, topCategories, hasData: all.length > 0 };
}
