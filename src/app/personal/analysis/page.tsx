import { formatINR } from "@/lib/format";
import { loadPersonal } from "@/lib/loadPersonal";
import { personalMonthLabel } from "@/lib/personal";
import { getPersonalAnalysis, type Bucket } from "@/lib/personalAnalysis";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { PersonalEmpty } from "@/components/personal/PersonalEmpty";
import { BucketTrend } from "@/components/Charts";

const BUCKET_META: Record<Bucket, { label: string; color: string; bar: string; hint: string }> = {
  need: { label: "NEED", color: "text-emerald-600", bar: "bg-emerald-500", hint: "rent, bills, groceries, health, education, fuel" },
  want: { label: "WANT", color: "text-violet-500", bar: "bg-violet-500", hint: "dining, shopping, travel, entertainment" },
  invest: { label: "INVEST", color: "text-amber-500", bar: "bg-amber-500", hint: "SIP, MF, savings — not spending" },
};

export default async function PersonalAnalysis({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const nav = <PersonalNav active="analysis" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} />;

  if (!c.selected) {
    return (
      <>
        {nav}
        <PersonalEmpty label={personalMonthLabel(c.selMonth, c.selYear)} />
      </>
    );
  }

  const a = await getPersonalAnalysis(c.member.id, c.selected.id);

  return (
    <>
      {nav}
      <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Analysis — {c.selected.label}</h1>
          <p className="text-sm text-slate-500">
            Your 50/30/20 split{" "}
            {a.rule.basis === "income" ? `(of ${formatINR(a.rule.income)} income)` : "(of what you spent — set your salary for the % of income)"}.
          </p>
        </div>

        {/* 50/30/20 cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(["need", "want", "invest"] as Bucket[]).map((b) => {
            const r = a.rule[b];
            const meta = BUCKET_META[b];
            const over = r.pct - r.target;
            return (
              <div key={b} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className={`text-sm font-bold ${meta.color}`}>{meta.label}</div>
                <div className="text-[11px] text-slate-400">TARGET {r.target}%</div>
                <div className="mt-2 text-3xl font-extrabold text-slate-800">{r.pct.toFixed(1)}%</div>
                <div className={`text-xs ${Math.abs(over) < 0.05 ? "text-slate-400" : over > 0 ? "text-red-500" : "text-emerald-600"}`}>
                  {over > 0 ? `+${over.toFixed(1)}% over` : `${over.toFixed(1)}% under`}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full ${meta.bar}`} style={{ width: `${Math.min(100, r.pct)}%` }} />
                </div>
                <div className="mt-1 text-[11px] tabular-nums text-slate-500">{formatINR(r.amount)}</div>
                <div className="mt-1 text-[10px] leading-tight text-slate-400">{meta.hint}</div>
              </div>
            );
          })}
        </div>

        {!a.hasData ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            No spending yet to analyse. Log some spends and set category buckets in Setup.
          </p>
        ) : (
          <>
            {/* monthly trend */}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Monthly spending — by bucket</h2>
              <BucketTrend data={a.monthly.map((m) => ({ label: m.label, need: m.need, want: m.want, invest: m.invest }))} />
            </div>

            {/* top categories this month */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Top categories · {c.selected.label}</h2>
              <ul className="space-y-2">
                {a.topCategories.map((t) => (
                  <li key={t.name} className="flex items-center gap-2 text-sm">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${BUCKET_META[t.bucket].bar}`} />
                    <span className="flex-1 truncate text-slate-600">
                      {t.icon} {t.name}
                    </span>
                    <span className="tabular-nums font-medium text-slate-800">{formatINR(t.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        <p className="text-center text-xs text-slate-400">
          Not sure if something&apos;s a need or a want? Set each category&apos;s bucket in <b>Setup</b>.
        </p>
      </main>
    </>
  );
}
