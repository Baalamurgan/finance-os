import { formatINR, pctLabel } from "@/lib/format";
import { loadPersonal } from "@/lib/loadPersonal";
import { personalMonthLabel } from "@/lib/personal";
import { getPersonalAnalysis, type Bucket } from "@/lib/personalAnalysis";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { PersonalEmpty } from "@/components/personal/PersonalEmpty";
import { PersonalRangeTabs } from "@/components/personal/PersonalRangeTabs";
import { BucketTrend, CashFlowChart } from "@/components/Charts";
import { FlowHero, FlowLegend, Highlights, Panel, ShareList, signedINR, type Highlight } from "@/components/analysis/AnalysisParts";

const BUCKET_META: Record<Bucket, { label: string; color: string; bar: string; hint: string }> = {
  need: { label: "NEED", color: "text-emerald-600", bar: "bg-emerald-500", hint: "rent, bills, groceries, health, education, fuel" },
  want: { label: "WANT", color: "text-violet-500", bar: "bg-violet-500", hint: "dining, shopping, travel, entertainment" },
  invest: { label: "INVEST", color: "text-amber-500", bar: "bg-amber-500", hint: "SIP, MF, savings — not spending" },
};

export default async function PersonalAnalysis({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string; range?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const nav = <PersonalNav active="analysis" account={c.account} selYear={c.selYear} selMonth={c.selMonth} dataMonths={c.dataMonths} financeDue={c.cardReminders.length > 0} />;

  if (!c.selected) {
    return (
      <>
        {nav}
        <PersonalEmpty label={personalMonthLabel(c.selMonth, c.selYear)} />
      </>
    );
  }

  const rangeKey = sp.range ?? "6";
  const rangeMonths = rangeKey === "all" ? null : Number(rangeKey) || 6;
  const a = await getPersonalAnalysis(c.member.id, c.selected.id, rangeMonths);
  const r = a.range;
  const rangeLabel = rangeMonths ? `last ${r.months} month${r.months === 1 ? "" : "s"}` : "all time";
  const vs = r.prev ? `prev ${r.prev.months} mo` : "";

  // ── Highlights ──
  const highlights: Highlight[] = [
    { icon: "📅", label: "Average out / month", value: formatINR(Math.round(r.avgOut)), sub: `income ${formatINR(Math.round(r.income / Math.max(1, r.months)))} / month` },
  ];
  const top = a.topCategories[0];
  if (top) highlights.push({ icon: "🏆", label: "Biggest category", value: `${top.icon ?? ""} ${top.name}`.trim(), sub: `${formatINR(top.total)} · ${pctLabel((top.total / (r.out || 1)) * 100)} of out` });
  if (r.series.length > 1) {
    const best = [...r.series].sort((x, y) => y.balance - x.balance)[0];
    highlights.push({ icon: "🌟", label: "Best month", value: best.label, sub: `${signedINR(best.balance)} saved`, tone: best.balance >= 0 ? "good" : "bad" });
    const saved = r.series.filter((x) => x.balance > 0).length;
    highlights.push({ icon: "🔥", label: "Months you saved", value: `${saved} of ${r.series.length}`, sub: saved === r.series.length ? "every single month" : `${r.series.length - saved} went over`, tone: saved * 2 >= r.series.length ? "good" : "bad" });
  }

  // 50/30/20 as one bar: each bucket's share of the basis; the rest is what's left unspent.
  const rule = (["need", "want", "invest"] as Bucket[]).map((b) => ({ b, ...a.rule[b] }));
  const used = rule.reduce((s, x) => s + x.pct, 0);
  const scale = Math.max(100, used);

  return (
    <>
      {nav}
      <main className="fo-rise mx-auto max-w-3xl space-y-5 p-4 pb-28 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-slate-900">Analysis</h1>
          <PersonalRangeTabs active={rangeKey} />
        </div>

        <FlowHero
          tone="personal"
          idPrefix={`pa-${rangeKey}`}
          leftLabel={`Saved · ${rangeLabel}`}
          income={r.income}
          spent={r.out}
          prev={r.prev ? { income: r.prev.income, spent: r.prev.out } : null}
          vs={vs}
          spentSub={r.expenses > 0 && r.spends > 0 ? `spends ${formatINR(r.spends)}` : undefined}
        />

        <Highlights items={highlights} />

        {r.series.length > 1 && (
          <Panel title="Cash flow" sub={`Income and spending, month by month · ${rangeLabel}`} right={<FlowLegend />}>
            <CashFlowChart data={r.series} focus={null} />
          </Panel>
        )}

        <Panel
          title={`50/30/20 · ${c.selected.label}`}
          sub={a.rule.basis === "income" ? `Of ${formatINR(a.rule.income)} income this month` : "Of what you spent — set your salary for the % of income"}
        >
          <div className="relative">
            <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100">
              {rule.filter((x) => x.pct > 0).map((x, i) => (
                <div key={x.b} className={`fo-bar h-full ${BUCKET_META[x.b].bar}`} style={{ width: `${(x.pct / scale) * 100}%`, animationDelay: `${100 + i * 120}ms` }} />
              ))}
            </div>
            {/* target lines: needs end at 50%, wants at 80% */}
            {[50, 80].map((t) => (
              <span key={t} className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-slate-500/50" style={{ left: `${(t / scale) * 100}%` }} aria-hidden />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {rule.map((x) => {
              const meta = BUCKET_META[x.b];
              const diff = x.pct - x.target;
              return (
                <div key={x.b} className="rounded-xl bg-slate-50 p-3">
                  <div className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${meta.bar}`} />
                    <span className={`text-[11px] font-bold ${meta.color}`}>{meta.label}</span>
                  </div>
                  <div className="mt-1 text-2xl font-extrabold tabular-nums text-slate-800">{x.pct.toFixed(0)}%</div>
                  <div className="text-[10px] text-slate-400">target {x.target}%</div>
                  <div className={`mt-0.5 text-[11px] font-semibold ${Math.abs(diff) < 0.5 ? "text-slate-400" : (x.b === "invest" ? diff < 0 : diff > 0) ? "text-red-500" : "text-emerald-600"}`}>
                    {Math.abs(diff) < 0.5 ? "on target" : `${diff > 0 ? "+" : ""}${diff.toFixed(0)}%`}
                  </div>
                  <div className="mt-1 truncate text-[11px] tabular-nums text-slate-500">{formatINR(x.amount)}</div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-snug text-slate-400">
            Need: {BUCKET_META.need.hint}. Want: {BUCKET_META.want.hint}. Invest: {BUCKET_META.invest.hint}.
          </p>
        </Panel>

        {!a.hasData ? (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            No spending yet to analyse. Log some spends and set category buckets in Setup.
          </p>
        ) : (
          <>
            <Panel title="Top categories" sub={`Biggest first · ${rangeLabel}`}>
              <ShareList
                rows={a.topCategories.map((t) => ({ key: t.name, name: `${t.icon ?? ""} ${t.name}`.trim(), amount: t.total, dot: BUCKET_META[t.bucket].bar }))}
                total={r.out}
                tone="personal"
                show={8}
                barClass={(row) => BUCKET_META[a.topCategories.find((t) => t.name === row.key)?.bucket ?? "want"].bar}
              />
            </Panel>

            <Panel title="Monthly spending by bucket" sub="Need, want and invest each month">
              <BucketTrend data={a.monthly.map((m) => ({ label: m.label, need: m.need, want: m.want, invest: m.invest }))} />
            </Panel>
          </>
        )}

        <p className="text-center text-xs text-slate-400">
          Not sure if something&apos;s a need or a want? Set each category&apos;s bucket in <b>Setup</b>.
        </p>
      </main>
    </>
  );
}
