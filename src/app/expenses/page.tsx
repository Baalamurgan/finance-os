import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getTrackedExpenses } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { AddSpendModal } from "@/components/AddSpendModal";
import { SpendDeleteButton } from "@/components/SpendDeleteButton";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return null;

  const nav = (
    <NavHeader
      active="expenses"
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
  );

  if (c.noData || !c.selected) {
    return (
      <>
        {nav}
        <main className="mx-auto max-w-2xl p-16 text-center text-slate-500">
          No month selected. Start a month on the Sheet tab first.
        </main>
      </>
    );
  }

  const { cards, totalAllocation, totalSpent, totalRemaining } = await getTrackedExpenses(
    c.household.id,
    c.selected.id
  );
  // budgeted categories first; no-budget (Misc) last
  const ordered = [...cards].sort(
    (a, b) => (a.allocation > 0 ? 0 : 1) - (b.allocation > 0 ? 0 : 1)
  );
  const open = c.selected.status === "open";

  return (
    <>
      {nav}
      <main className="mx-auto max-w-7xl space-y-5 p-6 pb-28 sm:pb-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {c.selected.label} — daily spends
            </h1>
            <p className="text-sm text-slate-500">
              Daily variable spending against each category&apos;s budget — the unspent remainder
              moves to Piggy at wind-down. For loans / bills / one-offs that change the balance, use
              <b> + Add expense</b> on the Sheet instead.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-right">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Spent / Allocated
            </div>
            <div className="text-lg font-bold text-slate-800">
              {formatINR(totalSpent)}{" "}
              <span className="text-sm font-normal text-slate-400">
                / {formatINR(totalAllocation)}
              </span>
            </div>
            <div className={`text-xs ${totalRemaining >= 0 ? "text-green-600" : "text-red-600"}`}>
              {totalRemaining >= 0 ? "Remaining " : "Over by "}
              {formatINR(Math.abs(totalRemaining))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {ordered.map((card) => {
            const pct =
              card.allocation > 0 ? Math.min((card.spent / card.allocation) * 100, 100) : 0;
            return (
              <section
                key={card.id}
                className="flex flex-col rounded-xl border border-slate-200 bg-white"
              >
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <h2 className="font-semibold text-slate-800">{card.name}</h2>
                  {open && (
                    <AddSpendModal
                      periodId={c.selected!.id}
                      trigger="card"
                      fixedCategory={{ id: card.id, name: card.name }}
                      isHead={c.isHead}
                      members={c.members}
                      currentMemberId={c.currentMember?.id}
                    />
                  )}
                </div>

                {/* allocation / spent / remaining — or 'no budget' for Misc */}
                <div className="px-4 pt-3">
                  {card.allocation > 0 ? (
                    <>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">
                          Spent <b className="text-slate-800">{formatINR(card.spent)}</b>
                          <span className="text-slate-400"> / {formatINR(card.allocation)}</span>
                        </span>
                        <span
                          className={`text-xs font-medium ${
                            card.overBudget ? "text-red-600" : "text-green-600"
                          }`}
                        >
                          {card.overBudget
                            ? `over by ${formatINR(card.spent - card.allocation)}`
                            : `${formatINR(card.remaining)} left → Piggy`}
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${card.overBudget ? "bg-red-500" : "bg-indigo-500"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">
                        Spent <b className="text-slate-800">{formatINR(card.spent)}</b>
                      </span>
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        No budget · deducted from next month
                      </span>
                    </div>
                  )}
                </div>

                {/* spends list — max ~5 rows then scroll */}
                <div className="flex-1 divide-y divide-slate-100 overflow-y-auto px-4 py-2 sm:max-h-64">
                  {card.spends.length === 0 && (
                    <p className="py-3 text-sm text-slate-400">No spends logged yet.</p>
                  )}
                  {card.spends.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div className="flex min-w-0 items-center gap-2">
                        {s.imagePath && (
                          <a href={s.imagePath} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={s.imagePath}
                              alt="receipt"
                              className="h-9 w-9 rounded object-cover"
                            />
                          </a>
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-800">{s.label}</div>
                          <div className="text-[11px] text-slate-400">
                            {s.member?.name ?? "Shared"} ·{" "}
                            {new Date(s.createdAt).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                            })}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums text-slate-700">{formatINR(s.amount)}</span>
                        {open && <SpendDeleteButton id={s.id} />}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {!open && (
          <p className="text-center text-xs text-slate-400">
            This month is closed — spends are locked.
          </p>
        )}
      </main>
    </>
  );
}
