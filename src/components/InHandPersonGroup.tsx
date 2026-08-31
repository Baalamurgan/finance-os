"use client";

import { useState } from "react";
import { formatINR } from "@/lib/format";
import type { InHand } from "@/lib/queries";
import { toggleBillPaid, unpayPeriodicBill, unpayMiscBill } from "@/app/actions";
import { PayBillModal } from "@/components/PayBillModal";
import { MiscPayModal } from "@/components/MiscPayModal";

export function InHandPersonGroup({
  group,
  isTreasurer,
  pool,
  sharedNet,
  monthBalance,
  billsHeldForMembers = 0,
  isPiggyHolder,
  piggy,
  pendingPiggyLump,
  canToggle,
  periodId,
  generalPiggy,
  currentMemberId,
  open,
  selYear,
  selMonth,
}: {
  group: InHand["byPerson"][number];
  isTreasurer: boolean;
  pool: number;
  sharedNet: number;
  monthBalance: number;
  billsHeldForMembers?: number;
  isPiggyHolder: boolean;
  piggy: number;
  pendingPiggyLump: number;
  canToggle: boolean;
  periodId: number;
  generalPiggy: number;
  currentMemberId: number | null;
  open: boolean;
  selYear: number;
  selMonth: number;
}) {
  const { name, cats, unpaidBills, paidBills, earmarked, sinkingFunds, sinkingHeld, unpaidPeriodic, paidPeriodic, carried, carriedDue, miscSpent, net, pendingPiggyHeld, yetToReceive, selfFundsBills } = group;
  // Per-card toggle: include or exclude this member's own misc/out-of-pocket in their total.
  // Default = include (the true position). Excluding shows "budget + bills + savings" only, so
  // someone can see where they'd stand without their discretionary spending counted.
  const [inclMisc, setInclMisc] = useState(true);
  // `net` already subtracts miscSpent; excluding it just adds that back.
  const shownNet = inclMisc ? net : net + miscSpent;
  // The bill's payer (their own group) gets the SAME pay / modal / undo controls as head/manager
  // for an open month — not a reduced view. `canToggle` already covers head/manager on any group.
  const selfPayer = !canToggle && open && group.memberId === currentMemberId;
  const canPay = canToggle || selfPayer;
  const poolAmt = isTreasurer ? pool : 0;
  // The holder has RECEIVED the general Piggy minus whatever's still pending hand-over from the
  // owners (that lump sits in the owners' `net` until they hand it over). `net` already includes
  // this person's own pendingPiggyHeld, so it isn't re-added here.
  const piggyAmt = isPiggyHolder ? piggy - pendingPiggyLump : 0;
  const total = shownNet + poolAmt + piggyAmt + sinkingHeld;
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
        {/* Savings this person is holding toward a periodic bill (moves to the fund at wind-down) */}
        {earmarked.map((e) => (
          <li key={`sv${e.id}`} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-teal-600">
              Set aside · {e.name} <span className="text-[10px] text-slate-400">held for the bill</span>
            </span>
            <span className="shrink-0 tabular-nums text-teal-700">{formatINR(e.amount)}</span>
          </li>
        ))}
        {/* Accrued sinking-fund holds this person is the saver of — held separately from the Piggy. */}
        {sinkingFunds.map((f) => (
          <li key={`sf${f.name}`} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-indigo-600">
              🏦 Sinking · {f.name} <span className="text-[10px] text-slate-400">fund held</span>
            </span>
            <span className="shrink-0 tabular-nums font-medium text-indigo-700">{formatINR(f.amount)}</span>
          </li>
        ))}
        {miscSpent > 0 && (
          <li className="flex items-center justify-between gap-2 text-xs">
            <span className={`flex min-w-0 items-center gap-1.5 ${inclMisc ? "text-amber-600" : "text-slate-400"}`}>
              {group.memberId != null ? (
                <a
                  href={`/expenses?y=${selYear}&m=${selMonth}&member=${group.memberId}`}
                  title={`See ${name}'s misc & out-of-pocket spends`}
                  className={`truncate underline decoration-dotted underline-offset-2 hover:text-amber-700 ${inclMisc ? "" : "line-through"}`}
                >
                  Miscellaneous &amp; out-of-pocket
                </a>
              ) : (
                <span className={`truncate ${inclMisc ? "" : "line-through"}`}>Miscellaneous &amp; out-of-pocket</span>
              )}
              <button
                type="button"
                onClick={() => setInclMisc((v) => !v)}
                title={inclMisc ? "Exclude misc from this total" : "Include misc in this total"}
                className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${inclMisc ? "border-amber-200 text-amber-500 hover:bg-amber-50" : "border-slate-200 text-slate-400 hover:bg-slate-50"}`}
              >
                {inclMisc ? "counted" : "excluded"}
              </button>
            </span>
            <span className={`shrink-0 tabular-nums ${inclMisc ? "text-red-600" : "text-slate-300 line-through"}`}>− {formatINR(miscSpent)}</span>
          </li>
        )}
        {isTreasurer && (
          <>
            <li className="flex items-center justify-between gap-2 border-t border-dashed border-slate-100 pt-1 text-xs">
              <span className="truncate font-medium text-indigo-600">Family pool held</span>
              <span className="shrink-0 tabular-nums font-semibold text-indigo-700">{formatINR(pool)}</span>
            </li>
            <li className="flex items-center justify-between gap-2 pl-3 text-xs">
              <span className="truncate text-slate-500" title="Net of everyone's shared-expense settlement — what the family jointly owns this month">
                <span className="mr-1 text-slate-300">↳</span>Shared settlement
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">{formatINR(sharedNet)}</span>
            </li>
            <li className="flex items-center justify-between gap-2 pl-3 text-xs">
              <span className="truncate text-slate-500" title="Unspent balance carried in this month's pool">
                <span className="mr-1 text-slate-300">↳</span>Month balance
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">{formatINR(monthBalance)}</span>
            </li>
            {billsHeldForMembers > 0.005 && (
              <li className="flex items-center justify-between gap-2 pl-3 text-xs">
                <span className="truncate text-slate-500" title="Cash the treasurer holds to pay out members' pool-funded bills (they've yet to receive it)">
                  <span className="mr-1 text-slate-300">↳</span>Bills to disburse
                </span>
                <span className="shrink-0 tabular-nums text-slate-500">{formatINR(billsHeldForMembers)}</span>
              </li>
            )}
          </>
        )}
        {isPiggyHolder && piggyAmt !== 0 && (
          <li className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-pink-600">🐷 General Piggy held <span className="text-[10px] text-slate-400">excl. sinking</span></span>
            <span className="shrink-0 tabular-nums font-medium text-pink-700">{formatINR(piggyAmt)}</span>
          </li>
        )}
        {/* Owner still holding last month's Piggy leftover, to hand to the holder (this IS in their total). */}
        {pendingPiggyHeld > 0.005 && (
          <li className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-amber-600">🐷 holding for Piggy <span className="text-[10px] text-slate-400">hand to the holder</span></span>
            <span className="shrink-0 tabular-nums font-medium text-amber-700">{formatINR(pendingPiggyHeld)}</span>
          </li>
        )}
        {/* Piggy holder still waiting on the owners' leftover (NOT in their total). */}
        {isPiggyHolder && pendingPiggyLump > 0.005 && (
          <>
            <li className="pt-2">
              <div className="border-t border-slate-200" />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Pending hand-over</span>
                <span className="text-[9px] text-slate-400">reminder · not in your in-hand yet</span>
              </div>
            </li>
            <li className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-amber-600">🐷 yet to receive <span className="text-[10px] text-slate-400">last month’s leftovers, still with owners</span></span>
              <span className="shrink-0 tabular-nums font-medium text-amber-700">{formatINR(pendingPiggyLump)}</span>
            </li>
          </>
        )}

        {/* Bills to pay THIS month — assigned bills (loans / EMIs / interest / fixed) AND periodic
            fund bills. A SELF-FUNDER (net contributor) holds this cash from their own salary, so it's
            IN their in-hand total; a pool-funded receiver still awaits it (`yetToReceive`), and periodic
            fund bills are drawn from the fund (neither). */}
        {(unpaidBills.length > 0 || unpaidPeriodic.length > 0) && (
          <>
            <li className="pt-2">
              <div className="border-t border-slate-200" />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-teal-600">
                  Bills to pay this month
                </span>
                <span className="text-[9px] text-slate-400">
                  {selfFundsBills && unpaidBills.length > 0
                    ? "you hold this cash · included in your in-hand"
                    : yetToReceive > 0.005
                    ? `yet to receive ${formatINR(yetToReceive)} from the pool · not in your in-hand`
                    : "reminder · paid from the fund, not your in-hand"}
                </span>
              </div>
            </li>
            {unpaidBills.map((b) => {
              const st = b.due?.status;
              return (
                <li key={`ub${b.id}`} className={`flex items-center justify-between gap-2 rounded-md text-xs ${st === "overdue" ? "bg-red-50 px-1.5 py-0.5" : st === "soon" ? "bg-amber-50 px-1.5 py-0.5" : ""}`}>
                  <span className={`truncate ${st === "overdue" ? "text-red-700" : "text-slate-500"}`}>
                    {b.name} <span className="text-[10px] text-indigo-400">bill</span>
                    {b.due && <DueChip due={b.due} />}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className={`tabular-nums ${st === "overdue" ? "font-medium text-red-700" : "text-slate-600"}`}>{formatINR(b.amount)}</span>
                    {!b.due && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">to pay</span>}
                    {canPay && (b.misc
                      ? <MiscPayModal id={b.id} name={b.name} estimate={b.amount} generalPiggy={generalPiggy} />
                      : <PaidToggle id={b.id} title="Mark this bill paid" label="✓ paid" />)}
                  </span>
                </li>
              );
            })}
            {unpaidPeriodic.map((b) => (
              <li key={`pb${b.categoryId}`} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-slate-500">
                  {b.name} <span className="text-[10px] text-teal-500">bill due</span>
                  {b.due && <DueChip due={b.due} />}
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
                  {canPay && (b.misc
                    ? <form action={unpayMiscBill}><input type="hidden" name="id" value={b.id} /><button type="submit" title="Undo payment (reverses the Piggy reconciliation)" className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-slate-600">undo</button></form>
                    : <PaidToggle id={b.id} title="Mark unpaid" label="undo" />)}
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
      {shownNet < 0 && (
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
  if (due.status === "soon" && due.days === 0) {
    return <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">due today</span>;
  }
  if (due.status === "soon") {
    const when = due.days === 1 ? "tomorrow" : `in ${due.days}d`;
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
