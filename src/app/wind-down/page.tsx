import { redirect } from "next/navigation";
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

  // You wind down the EARLIEST open month first (the working month). If a later open month (e.g. a
  // provisional next month) is selected, bounce to the earliest open so this always shows the right
  // card. Closed months (viewing history) and the earliest-open itself are left alone.
  const earliestOpen = c.periods
    .filter((p) => p.status === "open")
    .sort((a, b) => a.year - b.year || a.month - b.month)[0] ?? null;
  if (earliestOpen && c.selected?.status === "open" && c.selected.id !== earliestOpen.id) {
    redirect(`/wind-down?y=${earliestOpen.year}&m=${earliestOpen.month}`);
  }

  const nav = (
    <NavHeader
      active="wind-down"
      householdName={c.household.name}
      selYear={c.selYear}
      selMonth={c.selMonth}
      previewPeriod={c.previewPeriod}
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

  // what each tracked category contributes at close:
  //  • non-sinking under budget → general Piggy; over budget → carried to next month
  //  • SINKING → settles against its own fund: share − spent (accrue if +, draw if −)
  //  • misc (no budget) → carried to next month as a one-off expense
  const budgeted = tracked.cards.filter((t) => t.allocation > 0);
  const piggyRows = budgeted.filter((t) => !sinkingIds.has(t.id) && t.remaining >= 0);
  const sinkingRows = budgeted.filter((t) => sinkingIds.has(t.id)); // all sinking, any sign
  const overBudget = budgeted.filter((t) => !sinkingIds.has(t.id) && t.remaining < 0);
  const miscCards = tracked.cards.filter((t) => t.allocation === 0 && t.spent > 0);

  const piggyAdd = piggyRows.reduce((s, t) => s + t.remaining, 0);
  const sinkingAdd = sinkingRows.reduce((s, t) => s + t.remaining, 0);
  // a fund that would end negative (bill exceeded share + accrued fund)
  const sinkingNegative = sinkingRows.filter((t) => t.fund + t.remaining < 0);
  // over-budget now REDUCES the balance carried forward (folded in, no separate line);
  // only misc (no-budget) spends carry as their own lines next month.
  const overspendTotal = overBudget.reduce((s, t) => s + -t.remaining, 0);
  const carriedRows = miscCards.map((t) => ({ name: `${t.name} (misc)`, amount: t.spent }));
  const carriedTotal = carriedRows.reduce((s, r) => s + r.amount, 0);
  // The month's surplus BEFORE over-budget is absorbed (carry-in + income − expense). Over-budget
  // spending eats into it; whatever's left over (if negative) is the net shortfall.
  const preOverspend = c.selected.carryForward + rollup.totalIncome - rollup.totalExpense;
  const carryOut = preOverspend - overspendTotal;
  const absorbed = Math.max(0, Math.min(preOverspend, overspendTotal));
  const nm = c.selected.month === 12 ? 1 : c.selected.month + 1;
  const ny = c.selected.month === 12 ? c.selected.year + 1 : c.selected.year;
  const nextLabel = `${new Date(ny, nm - 1, 1).toLocaleString("en-US", { month: "short" }).toUpperCase()} ${ny}`;

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
          c.canEdit ? (
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-700">
                When you wind down, here&apos;s what happens
              </h2>

              <Breakdown
                title="→ General Piggy (under-budget leftovers)"
                rows={piggyRows.map((t) => ({ name: t.name, amount: t.remaining }))}
                total={piggyAdd}
              />
              <Breakdown
                title="↔ Sinking funds (share − bill: + accrues, − draws from the fund)"
                rows={sinkingRows.map((t) => ({ name: t.name, amount: t.remaining }))}
                total={sinkingAdd}
              />
              {sinkingNegative.length > 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                  ⚠ {sinkingNegative.map((t) => t.name).join(", ")}: the bill is more than the share +
                  saved fund, so the fund will go negative and catch up from next months&apos; shares.
                </p>
              )}
              <Breakdown
                title="↓ Over-budget (reduces the balance carried forward)"
                rows={overBudget.map((t) => ({ name: t.name, amount: t.remaining }))}
                total={-overspendTotal}
              />
              <Breakdown
                title="→ Misc spends carried to next month (added as expenses there)"
                rows={carriedRows}
                total={carriedTotal}
              />
              <div className="flex justify-between border-t border-slate-100 pt-3 text-sm font-semibold text-slate-800">
                <span>{carryOut < 0 ? "Net shortfall → next month's budget" : "Balance carried to next month"}</span>
                <span className={`tabular-nums ${carryOut < 0 ? "text-red-700" : ""}`}>
                  {formatINR(carryOut)}
                </span>
              </div>
              {carryOut < 0 && overspendTotal > 0 && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
                  Why: this month&apos;s <b>{formatINR(preOverspend)}</b> surplus (carry-in + income − expense)
                  covered <b>{formatINR(absorbed)}</b> of the <b>{formatINR(overspendTotal)}</b> over-budget spending.
                  The remaining <b className="text-red-600">{formatINR(-carryOut)}</b> isn&apos;t carried as a negative
                  balance — it comes off next month&apos;s budget for the over-budget categor{overBudget.length > 1 ? "ies" : "y"}
                  {overBudget.length > 0 && <> ({overBudget.map((t) => t.name).join(", ")})</>}.
                </p>
              )}

              <WindDownButton periodId={c.selected.id} label={c.selected.label} leftovers={piggyAdd} nextLabel={nextLabel} />
            </section>
          ) : (
            <p className="rounded-xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-500">
              Only the head
              {(() => {
                const h = c.members.find((m) => m.role === "head")?.name;
                return h ? ` (${h})` : "";
              })()}{" "}
              or a manager can wind down {c.selected.label}.
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
