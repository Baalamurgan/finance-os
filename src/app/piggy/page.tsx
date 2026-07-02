import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getPiggyOverview, getSinkingBalances, getPiggyHistory } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { WithdrawPiggyModal } from "@/components/WithdrawPiggyModal";
import { DepositPiggyModal } from "@/components/DepositPiggyModal";
import { SetFundModal } from "@/components/SetFundModal";

export default async function PiggyPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return null;

  const { generalTotal, generalByCategory, sinking } = await getPiggyOverview(c.household.id);
  const sinkingTotal = sinking.reduce((s, x) => s + x.hold, 0);
  const sinkingBalances = await getSinkingBalances(c.household.id);
  const history = await getPiggyHistory(c.household.id);
  const sinkingCats = c.categories.filter((cat) => cat.sinking);
  const sinkingFunds = sinkingCats.map((cat) => ({ id: cat.id, name: cat.name }));

  return (
    <>
      <NavHeader
        active="piggy"
        householdName={c.household.name}
        selYear={c.selYear}
        selMonth={c.selMonth}
        members={c.members}
        categories={c.categories}
        account={c.account}
        isHead={c.isHead}
        piggyBalance={c.piggyBalance}
        periodId={c.selected?.id ?? null}
        periodOpen={c.selected?.status === "open"}
        currentMemberId={c.currentMember?.id}
      />

      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-slate-900">🐷 Piggy &amp; savings</h1>
          {c.isHead && (
            <div className="flex items-center gap-2">
              <DepositPiggyModal sinkingFunds={sinkingFunds} />
              {c.selected && c.selected.status === "open" && (
                <WithdrawPiggyModal
                  periodId={c.selected.id}
                  periodLabel={c.selected.label}
                  categories={c.categories.map((cat) => ({
                    id: cat.id,
                    name: cat.name,
                    sinking: cat.sinking,
                  }))}
                  available={{ general: generalTotal, sinking: sinkingBalances }}
                />
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-300 bg-slate-900 p-5 text-white">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-300">
            Total set aside in the account
          </div>
          <div className="mt-1 text-3xl font-extrabold">{formatINR(generalTotal + sinkingTotal)}</div>
          <div className="mt-1 text-xs text-slate-400">
            General Piggy {formatINR(generalTotal)} + sinking holds {formatINR(sinkingTotal)} — these
            live in your one bank account; the split below is just how it&apos;s earmarked.
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wide text-amber-700">
                General Piggy
              </div>
              {c.isHead && <SetFundModal target="general" name="General Piggy" current={generalTotal} />}
            </div>
            <div className="mt-1 text-3xl font-extrabold text-amber-800">
              {formatINR(generalTotal)}
            </div>
            <div className="mt-1 text-xs text-amber-700/70">
              Unspent remainders from variable categories
            </div>
          </div>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-indigo-700">
              Sinking funds (held)
            </div>
            <div className="mt-1 text-3xl font-extrabold text-indigo-800">
              {formatINR(sinkingTotal)}
            </div>
            <div className="mt-1 text-xs text-indigo-700/70">
              Saved up for upcoming bills (WiFi, Mobile…)
            </div>
          </div>
        </div>

        {/* general piggy breakdown */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            General Piggy by category
          </h2>
          {generalByCategory.length === 0 ? (
            <p className="text-sm text-slate-400">
              Nothing yet — remainders land here when you wind down a month.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {generalByCategory.map((g) => (
                <li key={g.name} className="flex justify-between py-2">
                  <span className="text-slate-600">{g.name}</span>
                  <span className={`tabular-nums ${g.amount < 0 ? "text-red-600" : "text-slate-800"}`}>
                    {formatINR(g.amount)}
                  </span>
                </li>
              ))}
              <li className="flex justify-between py-2 font-semibold text-slate-900">
                <span>Total</span>
                <span className="tabular-nums">{formatINR(generalTotal)}</span>
              </li>
            </ul>
          )}
        </section>

        {/* sinking funds */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Sinking funds</h2>
          {sinkingCats.length === 0 ? (
            <p className="text-sm text-slate-400">
              No sinking funds yet. Mark a category as a sinking fund in Setup.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {sinkingCats.map((cat) => (
                <li key={cat.id} className="flex items-center justify-between py-2">
                  <div>
                    <span className="font-medium text-slate-700">{cat.name}</span>
                    {cat.cycleMonths && (
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                        every {cat.cycleMonths} mo
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums font-semibold text-slate-800">
                      {formatINR(sinkingBalances[cat.id] ?? 0)}{" "}
                      <span className="text-xs font-normal text-slate-400">held</span>
                    </span>
                    {c.isHead && (
                      <SetFundModal target={String(cat.id)} name={cat.name} current={sinkingBalances[cat.id] ?? 0} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-400">
            Use the <b>Use Piggy</b> button to send money to Dad / a loan / a chit — it records the
            spend and reduces the chosen fund (you can&apos;t withdraw more than is available).
          </p>
        </section>

        {/* transaction history */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">History</h2>
          {history.length === 0 ? (
            <p className="text-sm text-slate-400">
              No activity yet. Deposits, wind-down accruals and withdrawals will show here.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-slate-700">
                      <span className="font-medium">{h.bucket}</span>
                      {h.note ? <span className="text-slate-400"> · {h.note}</span> : null}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {new Date(h.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      {h.period ? ` · ${h.period}` : ""}
                    </div>
                  </div>
                  <span className={`tabular-nums font-semibold ${h.amount < 0 ? "text-red-600" : "text-green-700"}`}>
                    {h.amount < 0 ? "−" : "+"}
                    {formatINR(Math.abs(h.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
