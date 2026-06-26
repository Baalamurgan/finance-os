import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getRollup, getTrackedExpenses } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { WindDownButton } from "@/components/WindDownButton";

export default async function WindDownPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return null;

  const nav = (
    <NavHeader
      active="wind-down"
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
    />
  );

  if (c.noData || !c.selected) {
    return (
      <>
        {nav}
        <main className="mx-auto max-w-2xl p-16 text-center text-slate-500">
          No month to wind down here.
        </main>
      </>
    );
  }

  const [rollup, tracked] = await Promise.all([
    getRollup(c.selected.id),
    getTrackedExpenses(c.household.id, c.selected.id),
  ]);
  const open = c.selected.status === "open";
  const sinkingIds = new Set(c.categories.filter((x) => x.sinking).map((x) => x.id));

  // what each tracked category contributes at close
  const toPiggy = tracked.cards.filter((t) => t.allocation > 0 && !sinkingIds.has(t.id));
  const toSinking = tracked.cards.filter((t) => t.allocation > 0 && sinkingIds.has(t.id));
  const miscCards = tracked.cards.filter((t) => t.allocation === 0 && t.spent > 0);

  const piggyAdd = toPiggy.reduce((s, t) => s + t.remaining, 0);
  const sinkingAdd = toSinking.reduce((s, t) => s + t.remaining, 0);
  const miscTotal = miscCards.reduce((s, t) => s + t.spent, 0);
  const carryOut = c.selected.carryForward + rollup.totalIncome - rollup.totalExpense;

  return (
    <>
      {nav}
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h1 className="text-xl font-bold text-slate-900">Wind down — {c.selected.label}</h1>

        <section
          className={`rounded-xl border p-5 ${
            rollup.balance >= 0 ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
          }`}
        >
          <div className="text-sm font-medium text-slate-600">This month you</div>
          <div
            className={`text-3xl font-bold ${
              rollup.balance >= 0 ? "text-green-700" : "text-red-700"
            }`}
          >
            {rollup.balance >= 0 ? "saved " : "overspent "}
            {formatINR(Math.abs(rollup.balance))}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            Income {formatINR(rollup.totalIncome)} − Expense {formatINR(rollup.totalExpense)}
          </div>
          {rollup.balance < 0 && (
            <div className="mt-2 text-sm font-medium text-red-700">
              Deficit month — covered by the carried-in balance
              {c.selected.carryForward !== 0 && ` (${formatINR(c.selected.carryForward)})`} / Piggy.
              {carryOut < 0 && (
                <span className="block">
                  ⚠ Next month starts in deficit: {formatINR(carryOut)} carried over.
                </span>
              )}
            </div>
          )}
        </section>

        {open ? (
          c.isHead ? (
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-700">
                When you wind down, here&apos;s what happens
              </h2>

              <Breakdown
                title="→ General Piggy (variable categories' leftover)"
                rows={toPiggy.map((t) => ({ name: t.name, amount: t.remaining }))}
                total={piggyAdd}
              />
              <Breakdown
                title="→ Sinking-fund holds (saved for upcoming bills)"
                rows={toSinking.map((t) => ({ name: t.name, amount: t.remaining }))}
                total={sinkingAdd}
              />
              {miscTotal > 0 && (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Misc {formatINR(miscTotal)} → deducted from next month&apos;s income
                </div>
              )}
              <div className="flex justify-between border-t border-slate-100 pt-3 text-sm font-semibold text-slate-800">
                <span>{carryOut < 0 ? "Deficit carried to next month" : "Balance carried to next month"}</span>
                <span className={`tabular-nums ${carryOut < 0 ? "text-red-700" : ""}`}>
                  {formatINR(carryOut)}
                </span>
              </div>

              <WindDownButton periodId={c.selected.id} label={c.selected.label} />
            </section>
          ) : (
            <p className="rounded-xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-500">
              Only the head of family can wind down the month.
            </p>
          )
        ) : (
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
            <div className="font-semibold text-slate-800">✓ {c.selected.label} is closed</div>
            <div className="mt-1">Moved to general Piggy: {formatINR(c.selected.movedToPiggy)}</div>
            {c.selected.closedAt && (
              <div className="mt-1 text-xs text-slate-400">
                Closed {new Date(c.selected.closedAt).toLocaleString("en-IN")}
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}

function Breakdown({
  title,
  rows,
  total,
}: {
  title: string;
  rows: { name: string; amount: number }[];
  total: number;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
        {title}
      </div>
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.name} className="flex justify-between">
            <span className="text-slate-600">{r.name}</span>
            <span className={`tabular-nums ${r.amount < 0 ? "text-red-600" : "text-slate-700"}`}>
              {formatINR(r.amount)}
            </span>
          </li>
        ))}
        <li className="flex justify-between border-t border-slate-100 pt-1 font-medium text-slate-800">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatINR(total)}</span>
        </li>
      </ul>
    </div>
  );
}
