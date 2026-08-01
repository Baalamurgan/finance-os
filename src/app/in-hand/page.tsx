import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getInHand, getMoneyPlan, type InHand } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { MoneyPlan } from "@/components/MoneyPlan";
import { toggleBillPaid, unpayPeriodicBill } from "@/app/actions";
import { PayBillModal } from "@/components/PayBillModal";

export default async function InHandPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return null;

  const nav = (
    <NavHeader
      active="in-hand"
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
          No month selected. Start a month on the Sheet tab first.
        </main>
      </>
    );
  }

  const open = c.selected.status === "open";
  const periodId = c.selected.id;
  // Real cash each person holds: budget left + bills to pay + savings held − misc spent.
  const inHand = await getInHand(c.household.id, periodId);
  const plan = await getMoneyPlan(c.household.id, periodId, inHand);
  const currentMemberId = c.currentMember?.id ?? null;
  const visibleGroups = c.isHead
    ? inHand.byPerson
    : inHand.byPerson.filter((g) => g.memberId === currentMemberId);
  // Settlement lock: once the month is settled, non-heads can't change bill/paid state.
  const canToggle = c.canEdit && open && !(c.locked && !c.isHead);
  const showInHand = visibleGroups.length > 0;

  return (
    <>
      {nav}
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">🧭 Money plan</h1>
          <p className="text-sm text-slate-500">
            {c.isHead
              ? "The order to move money this month, then who still holds what."
              : "Your steps this month, then your budget left + bills + savings − misc."}
          </p>
        </div>

        <MoneyPlan
          plan={plan}
          householdId={c.household.id}
          periodId={periodId}
          isHead={c.isHead}
          currentMemberId={currentMemberId}
          canEdit={c.canEdit}
          open={open}
          generalPiggy={inHand.generalPiggy}
        />

        {showInHand ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visibleGroups.map((g) => (
              <PersonGroup
                key={g.memberId}
                group={g}
                isTreasurer={g.memberId === inHand.treasurerId}
                pool={inHand.treasurerPool}
                sharedNet={inHand.shared.net}
                monthBalance={inHand.monthBalance}
                isPiggyHolder={g.memberId === inHand.piggyHolderId}
                piggy={inHand.piggyTotal}
                canToggle={canToggle}
                periodId={periodId}
                generalPiggy={inHand.generalPiggy}
                currentMemberId={currentMemberId}
                open={open}
              />
            ))}
          </div>
        ) : (
          <p className="text-center text-sm text-slate-400">
            Nothing in hand this month — no budget, bills, savings or misc.
          </p>
        )}

        {!open && (
          <p className="text-center text-xs text-slate-400">This month is closed — figures are locked.</p>
        )}
      </main>
    </>
  );
}

function PersonGroup({
  group,
  isTreasurer,
  pool,
  sharedNet,
  monthBalance,
  isPiggyHolder,
  piggy,
  canToggle,
  periodId,
  generalPiggy,
  currentMemberId,
  open,
}: {
  group: InHand["byPerson"][number];
  isTreasurer: boolean;
  pool: number;
  sharedNet: number;
  monthBalance: number;
  isPiggyHolder: boolean;
  piggy: number;
  canToggle: boolean;
  periodId: number;
  generalPiggy: number;
  currentMemberId: number | null;
  open: boolean;
}) {
  const { name, cats, unpaidBills, paidBills, earmarked, unpaidPeriodic, paidPeriodic, carried, carriedDue, miscSpent, net } = group;
  // The bill's payer (their own group) gets the SAME pay / modal / undo controls as head/manager
  // for an open month — not a reduced view. `canToggle` already covers head/manager on any group.
  const selfPayer = !canToggle && open && group.memberId === currentMemberId;
  const canPay = canToggle || selfPayer;
  const poolAmt = isTreasurer ? pool : 0;
  const piggyAmt = isPiggyHolder ? piggy : 0;
  const total = net + poolAmt + piggyAmt;
  const paidCount = paidBills.length + paidPeriodic.length;
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">
          {name}
          {isTreasurer && <span className="ml-1 text-[10px] font-normal text-indigo-500">treasurer</span>}
          {isPiggyHolder && <span className="ml-1 text-[10px] font-normal text-pink-500">piggy</span>}
        </span>
        <span className={`text-right text-sm font-bold tabular-nums ${total < 0 ? "text-red-600" : "text-emerald-700"}`}>
          {formatINR(total)}
          <span className="ml-1 text-[10px] font-normal text-slate-400">{total < 0 ? "to reclaim" : "in hand"}</span>
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {/* Pinned to the TOP: things owed from an earlier month that were never paid. A pure
            nag — already settled in their own month, so greyed and NOT part of this month's total.
            Regular bills just toggle ✓ paid; a periodic fund-bill can be paid now (drawn from its
            fund, in this open month) via the pay modal. */}
        {(carried.length > 0 || carriedDue.length > 0) && (
          <>
            <li>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-rose-600">⏰ Overdue — not paid</span>
                <span className="text-[9px] text-slate-400">reminder only · not in your total</span>
              </div>
            </li>
            {carried.map((c) => (
              <li key={`cb${c.id}`} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-slate-400">
                  {c.name} <span className="text-[10px] text-rose-400">carried from {c.from}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="tabular-nums text-slate-400">{formatINR(c.amount)}</span>
                  {canPay && <PaidToggle id={c.id} title="Mark this carried-over bill paid" label="✓ paid" />}
                </span>
              </li>
            ))}
            {carriedDue.map((b) => (
              <li key={`cd${b.categoryId}-${b.periodId}`} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-slate-400">
                  {b.name} <span className="text-[10px] text-rose-400">bill overdue from {b.fromMonth}</span>
                  <span className="text-[10px] text-slate-400"> · fund {formatINR(b.fund)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="tabular-nums text-slate-400">{formatINR(b.bill)}</span>
                  {canPay ? (
                    <PayBillModal categoryId={b.categoryId} periodId={b.periodId} spendPeriodId={periodId} carriedFrom={b.fromMonth} name={b.name} bill={b.bill} fund={b.fund} generalPiggy={generalPiggy} />
                  ) : (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">to pay</span>
                  )}
                </span>
              </li>
            ))}
            <li className="pb-0.5"><div className="border-b border-dashed border-rose-100" /></li>
          </>
        )}
        {cats.map((cat) => (
          <li key={cat.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-slate-500">{cat.name}</span>
            <span className="shrink-0 tabular-nums text-slate-400">
              spent {formatINR(cat.spent)}/{formatINR(cat.allocation)} ·{" "}
              <b className={cat.remaining < 0 ? "text-red-600" : "text-slate-600"}>{formatINR(cat.remaining)}</b>
            </span>
          </li>
        ))}
        {unpaidBills.map((b) => {
          const st = b.due?.status;
          return (
            <li key={b.id} className={`flex items-center justify-between gap-2 rounded-md text-xs ${st === "overdue" ? "bg-red-50 px-1.5 py-0.5" : st === "soon" ? "bg-amber-50 px-1.5 py-0.5" : ""}`}>
              <span className={`truncate ${st === "overdue" ? "text-red-700" : "text-slate-500"}`}>
                {b.name} <span className="text-[10px] text-indigo-400">bill</span>
                {b.due && <DueChip due={b.due} />}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className={`tabular-nums ${st === "overdue" ? "font-medium text-red-700" : "text-slate-600"}`}>{formatINR(b.amount)}</span>
                {!b.due && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">to pay</span>}
                {canPay && <PaidToggle id={b.id} title="Mark this bill paid" label="✓ paid" />}
              </span>
            </li>
          );
        })}
        {/* Savings this person is holding toward a periodic bill (moves to the fund at wind-down) */}
        {earmarked.map((e) => (
          <li key={`sv${e.id}`} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-teal-600">
              Set aside · {e.name} <span className="text-[10px] text-slate-400">held for the bill</span>
            </span>
            <span className="shrink-0 tabular-nums text-teal-700">{formatINR(e.amount)}</span>
          </li>
        ))}
        {miscSpent > 0 && (
          <li className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-amber-600">Miscellaneous &amp; out-of-pocket</span>
            <span className="shrink-0 tabular-nums text-red-600">− {formatINR(miscSpent)}</span>
          </li>
        )}
        {isTreasurer && (
          <li className="flex items-center justify-between gap-2 border-t border-dashed border-slate-100 pt-1 text-xs">
            <span className="truncate text-indigo-600">
              Family pool{" "}
              <span className="text-[10px] text-slate-400">
                shared {formatINR(sharedNet)} + month bal {formatINR(monthBalance)}
              </span>
            </span>
            <span className="shrink-0 tabular-nums font-medium text-indigo-700">{formatINR(pool)}</span>
          </li>
        )}
        {isPiggyHolder && piggy !== 0 && (
          <li className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-pink-600">🐷 Piggy bank held</span>
            <span className="shrink-0 tabular-nums font-medium text-pink-700">{formatINR(piggy)}</span>
          </li>
        )}

        {/* Bills due THIS month — separated below the ruler because they DON'T change the
            in-hand total (paid from the fund/Piggy). Just a reminder of what to pay. */}
        {unpaidPeriodic.length > 0 && (
          <>
            <li className="pt-2">
              <div className="border-t border-slate-200" />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-teal-600">
                  Bills to pay this month
                </span>
                <span className="text-[9px] text-slate-400">reminder · paid from the fund, not your in-hand</span>
              </div>
            </li>
            {unpaidPeriodic.map((b) => (
              <li key={`pb${b.categoryId}`} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-slate-500">
                  {b.name} <span className="text-[10px] text-teal-500">bill due</span>
                  <span className="text-[10px] text-slate-400">
                    {" "}· fund {formatINR(b.fund)}
                    {b.afterWindDown && <span className="text-violet-400"> (after {b.afterWindDown} winds down)</span>}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="tabular-nums text-slate-500">{formatINR(b.bill)}</span>
                  {canPay ? (
                    <PayBillModal categoryId={b.categoryId} periodId={periodId} name={b.name} bill={b.bill} fund={b.fund} generalPiggy={generalPiggy} />
                  ) : (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">to pay</span>
                  )}
                </span>
              </li>
            ))}
          </>
        )}
      </ul>
      {paidCount > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer list-none text-[11px] text-slate-400 [&::-webkit-details-marker]:hidden">
            ✓ Paid this month ({paidCount})
          </summary>
          <ul className="mt-1 space-y-1">
            {paidBills.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 text-xs text-slate-400">
                <span className="truncate line-through">{b.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="tabular-nums">{formatINR(b.amount)}</span>
                  {canPay && <PaidToggle id={b.id} title="Mark unpaid" label="undo" />}
                </span>
              </li>
            ))}
            {paidPeriodic.map((b) => (
              <li key={`pb${b.categoryId}`} className="flex items-center justify-between gap-2 text-xs text-slate-400">
                <span className="truncate line-through">{b.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="tabular-nums">{formatINR(b.bill)}</span>
                  {canPay && (
                    <form action={unpayPeriodicBill}>
                      <input type="hidden" name="categoryId" value={b.categoryId} />
                      <input type="hidden" name="periodId" value={periodId} />
                      <button type="submit" title="Undo payment" className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-slate-600">undo</button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {net < 0 && (
        <p className="mt-2 text-[11px] leading-tight text-amber-600">
          Fronted more than budget — reclaim from the treasurer at wind-down, or deduct from next month.
        </p>
      )}
    </div>
  );
}

const ord = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

// Due-date pill: red overdue · amber due-soon (≤2d) · slate for a set-but-chill date.
function DueChip({ due }: { due: { day: number; days: number; status: "overdue" | "soon" | "normal" } }) {
  if (due.status === "overdue") {
    const by = Math.abs(due.days);
    return <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">overdue {by > 0 ? `${by}d` : ""} · was {ord(due.day)}</span>;
  }
  if (due.status === "soon") {
    const when = due.days === 0 ? "today" : due.days === 1 ? "tomorrow" : `in ${due.days}d`;
    return <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">due {when}</span>;
  }
  return <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">due {ord(due.day)}</span>;
}

function PaidToggle({ id, title, label }: { id: number; title: string; label: string }) {
  return (
    <form action={toggleBillPaid}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        title={title}
        className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-emerald-300 hover:text-emerald-600"
      >
        {label}
      </button>
    </form>
  );
}
