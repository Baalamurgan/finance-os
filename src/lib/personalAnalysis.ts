import { prisma } from "@/lib/prisma";
import { istDayOf } from "@/lib/time";

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
    prisma.personalExpense.findMany({ where: { memberId, pending: false }, select: { periodId: true, categoryId: true, amount: true } }),
    prisma.personalSpend.findMany({ where: { memberId, pending: false }, select: { periodId: true, categoryId: true, amount: true, date: true } }),
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
  // The same number of months just before the window, for "vs earlier" (none for "all").
  const before = rangeMonths ? periods.slice(Math.max(0, periods.length - rangeMonths * 2), Math.max(0, periods.length - rangeMonths)) : [];
  const prev = before.length > 0 && before.length === window.length // like-for-like only
    ? {
        months: before.length,
        income: before.reduce((s, p) => s + p.income + (extraOf.get(p.id) ?? 0), 0),
        out: before.reduce((s, p) => s + (expByPeriod.get(p.id) ?? 0) + (spdByPeriod.get(p.id) ?? 0), 0),
      }
    : null;
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
    prev,
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

  // Money flow over the range: income → need / want / invest (+ saved) → the biggest categories in each.
  const bucketCats = { need: [] as { name: string; icon: string | null; total: number }[], want: [] as { name: string; icon: string | null; total: number }[], invest: [] as { name: string; icon: string | null; total: number }[] };
  const bucketTotals = { need: 0, want: 0, invest: 0 };
  for (const r of all.filter((x) => rangeIds.has(x.periodId))) bucketTotals[bucketOf.get(r.categoryId ?? -1) ?? "want"] += r.amount;
  for (const [id, total] of catTotals) {
    const cat = catOf.get(id);
    if (!cat) continue;
    bucketCats[(cat.bucket as Bucket) ?? "want"].push({ name: cat.name, icon: cat.icon, total });
  }
  for (const b of Object.keys(bucketCats) as Bucket[]) bucketCats[b].sort((x, y) => y.total - x.total);

  // Daily spends over the range (IST day) → the heatmap. Fixed lines have no day, so spends only.
  const dayMap = new Map<string, { amount: number; count: number; periodId: number }>();
  for (const sp of spends) {
    if (!rangeIds.has(sp.periodId)) continue;
    const day = istDayOf(sp.date);
    const e = dayMap.get(day) ?? { amount: 0, count: 0, periodId: sp.periodId };
    e.amount += sp.amount;
    e.count += 1;
    dayMap.set(day, e);
  }
  // each day links to its spends on the Spends tab (the month the spend is filed under)
  const ymOf = new Map(window.map((p) => [p.id, p]));
  const daily = [...dayMap.entries()].map(([date, v]) => {
    const p = ymOf.get(v.periodId);
    return { date, amount: Math.round(v.amount * 100) / 100, count: v.count, href: p ? `/personal/expenses?y=${p.year}&m=${p.month}&day=${date}` : undefined };
  });
  const first = window[0], lastP = window[window.length - 1];
  const pad = (n: number) => String(n).padStart(2, "0");
  // The months' calendar days, widened to any spend dated just outside them (a personal month can run on
  // a wind-down cycle rather than the calendar), so every spend lands on the grid.
  const dates = daily.map((d) => d.date).sort();
  const dailyRange = first && lastP
    ? (() => {
        const from = `${first.year}-${pad(first.month)}-01`;
        const to = `${lastP.year}-${pad(lastP.month)}-${pad(new Date(Date.UTC(lastP.year, lastP.month, 0)).getUTCDate())}`;
        return { from: dates[0] && dates[0] < from ? dates[0] : from, to: dates.length && dates[dates.length - 1] > to ? dates[dates.length - 1] : to };
      })()
    : null;

  return { monthly: monthly.slice(-18), rule, range, topCategories, hasData: all.length > 0, flow: { bucketTotals, bucketCats }, daily, dailyRange };
}
