import { formatINR, pctLabel } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { istTodayISO } from "@/lib/time";
import { getRollup, getRollupRange, getTrends, getCategoryTrendRange, getDailySpends } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { CashFlowChart, CategoryRangeChart } from "@/components/Charts";
import { BudgetList, FlowHero, FlowLegend, Highlights, Panel, ShareList, SplitBar, signedINR, type Highlight, type ShareRow } from "@/components/analysis/AnalysisParts";
import { AnalysisRangePicker } from "@/components/AnalysisRangePicker";
import { EmptyArt } from "@/components/motion/EmptyArt";
import { MoneyFlow, type FlowLink, type FlowNode } from "@/components/analysis/MoneyFlow";
import { SpendHeatmap } from "@/components/analysis/SpendHeatmap";

const MON = ["", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{
    y?: string;
    m?: string;
    mode?: string;
    fy?: string;
    fm?: string;
    ty?: string;
    tm?: string;
  }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) {
    return (
      <main className="mx-auto max-w-2xl p-10 text-center text-slate-600">
        Nothing to analyse yet.
      </main>
    );
  }

  const nav = (
    <NavHeader
      active="analysis"
      householdName={c.household.name}
      miscSubCategories={c.miscSubCategories}
      selYear={c.selYear}
      selMonth={c.selMonth}
      previewPeriod={c.previewPeriod}
      dataMonths={c.dataMonths}
      provisional={c.provisional}
      members={c.members}      categories={c.categories}
      account={c.account}
      isHead={c.isHead}
      piggyBalance={c.piggyBalance}
      periodId={c.selected?.id ?? null}
      periodOpen={c.selected?.status === "open"}
      currentMemberId={c.currentMember?.id}
      windDownReminder={c.windDownReminder}
      canEdit={c.canEdit}
      pinEnabled={c.pinEnabled}
      hasBiometric={c.hasBiometric}
      actualIsHead={c.actualIsHead}
      viewingAsMember={c.viewingAsMember}
    />
  );

  const isRange = sp.mode === "range" && !!(sp.fy && sp.fm && sp.ty && sp.tm);

  // Default the range picker's inputs sensibly (range = current ± / single month).
  const fromDefault = isRange
    ? { y: Number(sp.fy), m: Number(sp.fm) }
    : { y: c.selYear, m: c.selMonth };
  const toDefault = isRange
    ? { y: Number(sp.ty), m: Number(sp.tm) }
    : { y: c.selYear, m: c.selMonth };

  const picker = (
    <AnalysisRangePicker
      isRange={isRange}
      curYear={c.selYear}
      curMonth={c.selMonth}
      from={fromDefault}
      to={toDefault}
      dataMonths={c.periods.filter((p) => p.status !== "draft").map((p) => p.year * 12 + p.month - 1)}
    />
  );

  if (!isRange && (c.noData || !c.selected)) {
    return (
      <>
        {nav}
        <main className="fo-rise mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
          {picker}
          <EmptyArt title="No data to analyse for this month">Pick another month above, or switch to a range.</EmptyArt>
        </main>
      </>
    );
  }

  // Month keys (year*12 + month-1) so months compare/sort as numbers.
  const key = (y: number, m: number) => y * 12 + (m - 1);
  const lo = isRange ? Math.min(key(Number(sp.fy), Number(sp.fm)), key(Number(sp.ty), Number(sp.tm))) : key(c.selYear, c.selMonth);
  const hi = isRange ? Math.max(key(Number(sp.fy), Number(sp.fm)), key(Number(sp.ty), Number(sp.tm))) : key(c.selYear, c.selMonth);
  const prevKey = lo - 1;
  // Last month's sheet (month view) — for "what went up" per category.
  const prevPeriod = isRange ? null : c.periods.find((p) => key(p.year, p.month) === prevKey && p.status !== "draft") ?? null;

  // The sheets in view (for the daily heatmap): the month, or every sheet in the range.
  const viewIds = c.periods.filter((p) => p.status !== "draft" && key(p.year, p.month) >= lo && key(p.year, p.month) <= hi).map((p) => p.id);

  // Independent reads → one parallel round.
  const [rollup, allTrends, catTrend, prevRollup, daily] = await Promise.all([
    isRange
      ? getRollupRange(c.household.id, Number(sp.fy), Number(sp.fm), Number(sp.ty), Number(sp.tm))
      : getRollup(c.selected!.id),
    getTrends(c.household.id),
    isRange
      ? getCategoryTrendRange(c.household.id, Number(sp.fy), Number(sp.fm), Number(sp.ty), Number(sp.tm))
      : Promise.resolve(null),
    prevPeriod ? getRollup(prevPeriod.id) : Promise.resolve(null),
    getDailySpends(viewIds),
  ]);
  const tk = (t: { year: number; month: number }) => key(t.year, t.month);

  // Cash-flow chart: the range itself, or the 12 months up to the selected one.
  const flow = isRange ? allTrends.filter((t) => tk(t) >= lo && tk(t) <= hi) : allTrends.filter((t) => tk(t) <= hi).slice(-12);

  // What to compare with: last month, or the same number of months just before the range.
  const span = hi - lo + 1;
  const flowNow = allTrends.filter((t) => tk(t) >= lo && tk(t) <= hi);
  const before = allTrends.filter((t) => tk(t) >= lo - span && tk(t) < lo);
  // Only a like-for-like comparison: the earlier stretch must have as many months on record as this one.
  const prev = before.length > 0 && before.length === flowNow.length ? { income: before.reduce((s, t) => s + t.income, 0), spent: before.reduce((s, t) => s + t.expense, 0) } : null;
  const vs = isRange ? `prev ${span} mo` : cap(MON[((prevKey % 12) + 12) % 12 + 1]);

  // Categories, biggest first; month view shows the change vs last month.
  const prevByName = new Map((prevRollup?.byCategory ?? []).map((r) => [r.name, r.actual]));
  const spentCats = rollup.byCategory.filter((r) => r.actual > 0).sort((a, b) => b.actual - a.actual);
  const catTotal = spentCats.reduce((s, r) => s + r.actual, 0);
  const catRows: ShareRow[] = spentCats.map((r) => ({
    key: r.name,
    name: r.name,
    amount: r.actual,
    change: prevRollup ? r.actual - (prevByName.get(r.name) ?? 0) : null,
  }));
  const budgets = rollup.byCategory.filter((r) => r.planned > 0);
  const overs = budgets.filter((r) => r.actual > r.planned).sort((a, b) => b.actual - b.planned - (a.actual - a.planned));

  // Running month only: how far into the month we are (the "today" line on the budget bars).
  const today = new Date();
  const dayPct = !isRange && c.selYear === today.getFullYear() && c.selMonth === today.getMonth() + 1
    ? (today.getDate() / new Date(c.selYear, c.selMonth, 0).getDate()) * 100
    : null;

  // ── Highlights ──
  const highlights: Highlight[] = [];
  const top = spentCats[0];
  if (top) highlights.push({ icon: "🏆", label: "Biggest spend", value: top.name, sub: `${formatINR(top.actual)} · ${pctLabel((top.actual / (catTotal || 1)) * 100)} of spending` });
  if (isRange) {
    const months = Math.max(1, "monthsCount" in rollup ? rollup.monthsCount : flow.length); // months with a sheet
    highlights.push({ icon: "📅", label: "Average spent / month", value: formatINR(Math.round(rollup.totalExpense / months)), sub: `income ${formatINR(Math.round(rollup.totalIncome / months))} / month` });
    const best = [...flow].sort((a, b) => b.balance - a.balance)[0];
    if (best && flow.length > 1) highlights.push({ icon: "🌟", label: "Best month", value: best.label, sub: `${signedINR(best.balance)} left`, tone: best.balance >= 0 ? "good" : "bad" });
  } else {
    // (skip the biggest spend itself — it already has its own tile)
    const rises = catRows.filter((r) => (r.change ?? 0) > 0 && r.name !== top?.name).sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
    if (rises[0]) highlights.push({ icon: "📈", label: `Biggest jump vs ${vs}`, value: rises[0].name, sub: `+${formatINR(rises[0].change!)}`, tone: "bad" });
    const past = allTrends.filter((t) => tk(t) < lo).slice(-6);
    if (past.length >= 2) {
      const avg = past.reduce((s, t) => s + t.expense, 0) / past.length;
      const diff = rollup.totalExpense - avg;
      highlights.push({
        icon: "📊",
        label: `vs ${past.length}-month average`,
        value: Math.abs(diff) < 1 ? "Right on average" : `${formatINR(Math.round(Math.abs(diff)))} ${diff > 0 ? "more" : "less"}`,
        sub: `average spent ${formatINR(Math.round(avg))}`,
        tone: Math.abs(diff) < 1 ? null : diff > 0 ? "bad" : "good",
      });
    }
  }
  if (budgets.length > 0)
    highlights.push(
      overs.length > 0
        ? { icon: "🎯", label: "Over budget", value: overs.length === 1 ? overs[0].name : `${overs.length} budgets`, sub: overs.length === 1 ? `by ${formatINR(overs[0].actual - overs[0].planned)}` : overs.map((o) => o.name).join(", "), tone: "bad" }
        : { icon: "🎯", label: "Budgets", value: "All within budget", sub: `${budgets.length} budget${budgets.length === 1 ? "" : "s"} on track`, tone: "good" },
    );

  // ── Money flow: income sources → Income → where it went (biggest categories, the rest, budget not yet
  // spent, and what's left). Every band is a real figure; the right side adds up to Income exactly.
  const flowNodes: FlowNode[] = [];
  const flowLinks: FlowLink[] = [];
  const spentTotal = rollup.totalExpense, incomeTotal = rollup.totalIncome;
  if (incomeTotal > 0 || spentTotal > 0) {
    const srcMap = new Map<string, number>();
    if ("incomes" in rollup) for (const i of rollup.incomes) if (i.amount > 0) srcMap.set(i.source, (srcMap.get(i.source) ?? 0) + i.amount);
    let sources = [...srcMap.entries()].sort((a, b) => b[1] - a[1]);
    const srcSum = sources.reduce((t, [, v]) => t + v, 0);
    if (sources.length === 0 || Math.abs(srcSum - incomeTotal) > 0.5) sources = incomeTotal > 0 ? [["Income", incomeTotal]] : [];
    if (sources.length > 4) sources = [...sources.slice(0, 3), ["Other income", sources.slice(3).reduce((t, [, v]) => t + v, 0)]];
    sources.forEach(([name, v], i) => { flowNodes.push({ id: `s${i}`, label: name, value: v, col: 0, color: "#16a34a" }); flowLinks.push({ from: `s${i}`, to: "hub", value: v }); });
    const short = spentTotal - incomeTotal;
    if (short > 0.5) { flowNodes.push({ id: "short", label: "Overspent", value: short, col: 0, color: "#dc2626" }); flowLinks.push({ from: "short", to: "hub", value: short }); }
    flowNodes.push({ id: "hub", label: "Income", value: Math.max(incomeTotal, spentTotal), col: 1, color: "#4f46e5" });
    const topN = spentCats.slice(0, 6);
    topN.forEach((r, i) => { flowNodes.push({ id: `c${i}`, label: r.name, value: r.actual, col: 2, color: "#ef4444" }); flowLinks.push({ from: "hub", to: `c${i}`, value: r.actual }); });
    const rest = catTotal - topN.reduce((t, r) => t + r.actual, 0);
    if (rest > 0.5) { flowNodes.push({ id: "rest", label: `${spentCats.length - topN.length} more categories`, value: rest, col: 2, color: "#f87171" }); flowLinks.push({ from: "hub", to: "rest", value: rest }); }
    const unspent = spentTotal - catTotal;
    if (unspent > 0.5) { flowNodes.push({ id: "unspent", label: "Budgeted, not spent", value: unspent, col: 2, color: "#94a3b8" }); flowLinks.push({ from: "hub", to: "unspent", value: unspent }); }
    const leftAmt = incomeTotal - spentTotal;
    if (leftAmt > 0.5) { flowNodes.push({ id: "left", label: "Left", value: leftAmt, col: 2, color: "#6366f1" }); flowLinks.push({ from: "hub", to: "left", value: leftAmt }); }
  }

  // Daily heatmap window: the month's calendar days, or the range's.
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const loY = Math.floor(lo / 12), loM = (lo % 12) + 1, hiY = Math.floor(hi / 12), hiM = (hi % 12) + 1;
  const dayFrom = `${loY}-${pad2(loM)}-01`;
  const dayTo = `${hiY}-${pad2(hiM)}-${pad2(new Date(Date.UTC(hiY, hiM, 0)).getUTCDate())}`;
  const todayIST = istTodayISO();

  const title = isRange
    ? `${cap(MON[Number(sp.fm)])} ${sp.fy} – ${cap(MON[Number(sp.tm)])} ${sp.ty}`
    : c.selected!.label;
  const necessary = rollup.necessaryVsOther.find((x) => x.name === "Necessary")?.value ?? 0;
  const other = rollup.necessaryVsOther.find((x) => x.name === "Other")?.value ?? 0;

  return (
    <>
      {nav}
      <main className="fo-rise mx-auto max-w-5xl space-y-5 p-4 pb-28 sm:p-6">
        {picker}
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold text-slate-900">{title}</h1>
          <span className="text-xs text-slate-400">{isRange ? `${span} months` : "Analysis"}</span>
        </div>

        <FlowHero
          tone="family"
          idPrefix={isRange ? "an-range" : "an-month"}
          leftLabel={isRange ? "Left over the range" : "Left this month"}
          income={rollup.totalIncome}
          spent={rollup.totalExpense}
          prev={prev}
          vs={vs}
        />

        <Highlights items={highlights} />

        {flow.length > 1 && (
          <Panel title="Cash flow" sub={isRange ? "Income and spending, month by month" : "Last 12 months · tap a month for details"} right={<FlowLegend />}>
            <CashFlowChart data={flow} focus={isRange ? null : c.selected!.label} />
          </Panel>
        )}

        {flowNodes.length > 1 && (
          <Panel title="Money flow" sub={`Where ${isRange ? "the range's" : "this month's"} income went · band width = rupees`}>
            <MoneyFlow nodes={flowNodes} links={flowLinks} total={Math.max(incomeTotal, spentTotal)} totalLabel="income" />
          </Panel>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Panel
            title="Where the money went"
            sub={<>By category · {formatINR(catTotal)}{prevRollup ? <> · ▲▼ vs {vs}</> : null}</>}
          >
            {catRows.length > 0 ? <ShareList rows={catRows} total={catTotal} tone="family" vs={vs} idPrefix="an-cat" /> : <p className="text-sm text-slate-400">No spending recorded.</p>}
          </Panel>

          <Panel title="Budgets" sub={dayPct != null ? "The line marks today" : "Spent against what was planned"}>
            {budgets.length > 0 ? (
              <BudgetList rows={budgets} dayPct={dayPct} idPrefix="an-bud" />
            ) : (
              <p className="text-sm text-slate-400">No budgets set for this {isRange ? "range" : "month"}.</p>
            )}
          </Panel>
        </div>

        <Panel title="Daily spending" sub="Spends by day · tap a day to see its spends">
          <SpendHeatmap
            days={daily.map((d) => {
              const p = c.periods.find((x) => x.id === d.periodId);
              return { ...d, href: p ? `/expenses?y=${p.year}&m=${p.month}&day=${d.date}` : undefined };
            })}
            from={dayFrom} to={dayTo} today={todayIST}
          />
        </Panel>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Panel title="Essentials vs other" sub="Sheet expenses marked necessary">
            <SplitBar parts={[{ name: "Essentials", value: necessary, color: "bg-indigo-500" }, { name: "Other", value: other, color: "bg-slate-300" }]} idPrefix="an-ess" />
          </Panel>
          <Panel title="By member" sub="Who the sheet expenses were for">
            {rollup.byMember.length > 0 ? (
              <ShareList
                rows={[...rollup.byMember].sort((a, b) => b.total - a.total).map((m) => ({ key: m.name, name: m.name, amount: m.total }))}
                total={rollup.byMember.reduce((s, m) => s + m.total, 0)}
                tone="family"
                idPrefix="an-mem"
              />
            ) : (
              <p className="text-sm text-slate-400">Nothing recorded.</p>
            )}
          </Panel>
        </div>

        {/* Range view: one category, budgeted vs spent month by month. */}
        {isRange && catTrend && catTrend.categories.length > 0 && (
          <Panel title="One category over the range" sub="Budgeted vs spent each month — the gap is what stayed unspent (→ Piggy)">
            <CategoryRangeChart months={catTrend.months} categories={catTrend.categories} />
          </Panel>
        )}
      </main>
    </>
  );
}

function cap(m: string | undefined) {
  return m ? m[0] + m.slice(1).toLowerCase() : "";
}
