"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatINR } from "@/lib/format";
import { markSettled, unsettle, toggleBillPaid, syncMonthFromSetup, markAdvanceSettled, unsettleAdvance } from "@/app/actions";
import { PayBillModal } from "@/components/PayBillModal";
import { ExpenseModal } from "@/components/ExpenseModal";
import { useToast } from "@/components/Toast";
import type { MoneyPlanResult } from "@/lib/queries";

// The shared, everyone-visible Money Plan: the month's transfers + bill payments as one ordered,
// dated checklist. Ticking a step writes through to the real record (settlement / bill paid) — the
// action itself enforces "head or the two parties involved". Done steps strike through in green.
// A member filter narrows to just one person's remaining to-dos (keeping each step's real number);
// Refresh re-pulls due dates + amounts from Setup into this month, then re-orders the plan.
export function MoneyPlan({
  plan, householdId, periodId, isHead, currentMemberId, canEdit, open, generalPiggy,
  billCategories, members, monthBalance,
}: {
  plan: MoneyPlanResult;
  householdId: number;
  periodId: number;
  isHead: boolean;
  currentMemberId: number | null;
  canEdit: boolean;
  open: boolean;
  generalPiggy: number;
  billCategories: { id: number; name: string; section?: string }[];
  members: { id: number; name: string }[];
  monthBalance: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [who, setWho] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [balances, setBalances] = useState<{ s: MoneyPlanResult["steps"][number]; n: number } | null>(null);

  // Everyone involved in a step (payer / from / to) → the filter's member list.
  const people = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of plan.steps) {
      if (s.fromId != null && s.fromName) m.set(s.fromId, s.fromName);
      if (s.toId != null && s.toName) m.set(s.toId, s.toName);
      if (s.payerId != null && s.payerName) m.set(s.payerId, s.payerName);
    }
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [plan.steps]);

  if (plan.total === 0) return null;
  const pct = plan.total ? Math.round((plan.done / plan.total) * 100) : 0;

  // Keep each step's REAL number (its position in the full plan); when a member is picked, show
  // only their remaining to-dos.
  const rows = plan.steps.map((s, i) => ({ s, n: i + 1 }));
  const shown = who == null
    ? rows
    : rows.filter(({ s }) => !s.done && (s.fromId === who || s.toId === who || s.payerId === who));
  const whoName = people.find((p) => p.id === who)?.name;

  const refresh = () =>
    startTransition(async () => {
      const r = await syncMonthFromSetup(periodId);
      router.refresh();
      toast(r.ok ? (r.updated > 0 ? `Refreshed — ${r.updated} line${r.updated > 1 ? "s" : ""} updated from Setup` : "Refreshed from Setup") : (r.error ?? "Couldn't refresh"), r.ok ? "success" : "error");
    });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">🧭 Money plan</h2>
          <p className="text-[11px] text-slate-400">The order to move money this month. Tick each as it happens. <span className="text-slate-300">·</span> <span className="text-slate-400">hub = the treasurer&apos;s running balance</span></p>
        </div>
        <span className="shrink-0 text-xs font-medium text-slate-500">{plan.done}/{plan.total} done</span>
      </div>

      {/* progress (always the WHOLE plan, not the filtered view) */}
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>

      {/* filter + refresh */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5">
          <FilterPill active={who == null} onClick={() => setWho(null)}>Everyone</FilterPill>
          {people.map((p) => (
            <FilterPill key={p.id} active={who === p.id} onClick={() => setWho(p.id)}>{p.name}</FilterPill>
          ))}
        </div>
        {open && canEdit && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            title="Add an expense to pay from the remaining balance — it lands on the Sheet and slots into the plan by its due date"
            className="shrink-0 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:border-emerald-300 hover:text-emerald-600"
          >
            + Expense
          </button>
        )}
        {open && canEdit && (
          <button
            type="button"
            onClick={refresh}
            disabled={pending}
            title="Re-pull due dates & amounts from Setup into this month, then re-order"
            className="shrink-0 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50"
          >
            {pending ? "↻ Syncing…" : "↻ Refresh"}
          </button>
        )}
      </div>

      {/* Add a one-off expense to pay from the remaining balance — lands on the Sheet and slots into
          the plan by its due date. Capped at the month balance; a blank due day sorts it last. */}
      <ExpenseModal
        hideTrigger
        controlledOpen={addOpen}
        onOpenChange={setAddOpen}
        periodId={periodId}
        categories={billCategories}
        members={members}
        balance={monthBalance}
        showDueDay
        defaultRepeat={false}
        newCategoryDefaultSection="Misc"
      />

      {plan.hubShortfall > 0 && who == null && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          ⚠️ The treasurer is short about <b>{formatINR(plan.hubShortfall)}</b> when a payment falls due before that money has arrived — plan to carry it from last month, or expect that step to run late.
        </div>
      )}

      {shown.length === 0 ? (
        <p className="rounded-lg bg-emerald-50/60 px-3 py-3 text-center text-xs text-emerald-700">
          ✓ {whoName ? `${whoName} has nothing left to do` : "Nothing left to do"} this month.
        </p>
      ) : (
        <>
        <p className="mb-1.5 text-[10px] text-slate-400">Tap any step&apos;s number <span className="mx-0.5 inline-grid h-3.5 w-3.5 place-items-center rounded-full ring-1 ring-slate-300 align-middle text-[8px]">1</span> to see everyone&apos;s cash before &amp; after it.</p>
        <ol className="space-y-1.5">
          {shown.map(({ s, n }) => {
            const isAllowance = s.kind === "allowance";
            const isPiggy = s.kind === "piggy";
            const isAdvance = s.kind === "advance";
            const isTransfer = s.kind === "transfer-in" || s.kind === "transfer-out";
            const canActTransfer = open && (isHead || currentMemberId === s.fromId || currentMemberId === s.toId);
            const canActBill = open && (canEdit || currentMemberId === s.payerId);
            const canActAllowance = open && (canEdit || currentMemberId === s.fromId || currentMemberId === s.toId);
            const title = isAllowance ? `Personal expense → ${s.toName}` : isPiggy ? `${s.fromName} → ${s.toName} · Piggy` : isAdvance || isTransfer ? `${s.fromName} → ${s.toName}` : `${s.payerName} → ${s.vendor}`;
            // Urgency (only while unpaid — a done step is never "overdue"): RED for overdue OR due
            // today (needs action now), AMBER for due in 1–2 days, plain otherwise.
            const urgent = !s.done && (s.status === "overdue" || (s.status === "soon" && (s.days ?? 1) <= 0));
            const soon = !s.done && s.status === "soon" && (s.days ?? 0) > 0;
            // Who moves cash in this step (before → after): a bill's payer; a transfer's both sides.
            // Fund bills draw the sinking fund (no cash), so nobody's balance moves — nothing to show.
            const cashParties: { id: number; name: string }[] = (
              s.kind === "bill"
                ? (s.fund ? [] : [{ id: s.payerId, name: s.payerName }])
                : [{ id: s.fromId, name: s.fromName }, { id: s.toId, name: s.toName }]
            ).filter((p): p is { id: number; name: string } => p.id != null && p.name != null);
            const short = s.senderShort ?? s.short; // member shortfall OR treasurer(hub) shortfall

            return (
              <li key={s.id} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs ${s.done ? "bg-emerald-50/50" : urgent ? "bg-red-50" : soon ? "bg-amber-50" : "bg-slate-50"}`}>
                <button
                  type="button"
                  onClick={() => setBalances({ s, n })}
                  title="Tap to see everyone's cash before & after this step"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-slate-500 ring-1 ring-slate-300 hover:bg-slate-200 hover:text-slate-800"
                >
                  {s.done ? <span className="text-emerald-600">✓</span> : n}
                </button>

                <div className="min-w-0 flex-1">
                  <div className={`flex flex-wrap items-center gap-1.5 ${s.done ? "text-slate-400 line-through" : "text-slate-800"}`}>
                    <span className="truncate font-medium">{title}</span>
                    {isAllowance && <span className="shrink-0 rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-500">personal · from hub</span>}
                    {isPiggy && <span className="shrink-0 rounded-full bg-pink-50 px-1.5 py-0.5 text-[9px] font-medium text-pink-500">🐷 to piggy · at wind-down</span>}
                    {!s.done && !isPiggy && <DayTag kind={s.kind} day={s.day} status={s.status ?? null} days={s.days ?? null} />}
                    {s.feedsBills && !s.done && <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-medium text-indigo-500">funds bills ↓</span>}
                    {s.fundsMember && !s.done && <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600">funds {s.toName} ↓</span>}
                    {s.reroute && !s.done && <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600" title="Paid directly, skipping the treasurer, because the hub can't fund it in time">direct · skips hub</span>}
                    {s.deferred && <span className="shrink-0 rounded-full bg-sky-50 px-1.5 py-0.5 text-[9px] font-medium text-sky-600" title="Added during the wind-down window — paid by the assignee at wind-down, kept out of this month's settlement">settles at wind-down</span>}
                    {isAdvance && <span className="shrink-0 rounded-full bg-teal-50 px-1.5 py-0.5 text-[9px] font-medium text-teal-600" title={`${s.fromName} fronts this so ${s.toName} can pay the next step`}>advance · funds {s.toName}</span>}
                  </div>
                  {!s.done && cashParties.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-slate-500">
                      {cashParties.map((p) => {
                        const before = s.balancesBefore?.[p.id] ?? 0;
                        const after = s.balancesAfter?.[p.id] ?? 0;
                        return (
                          <span key={p.id} className="tabular-nums">
                            <span className="font-medium text-slate-600">{p.name}</span> {formatINR(before)} → <span className={after < -0.005 ? "font-semibold text-red-600" : "text-slate-700"}>{formatINR(after)}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {!s.done && short != null && short > 0.005 && (
                    <div className="text-[10px] font-semibold text-red-600">
                      ⚠ {isPiggy || isTransfer || isAllowance ? s.fromName : s.payerName} needs {formatINR(short)} more in hand first
                    </div>
                  )}
                  {!s.done && s.infeasibleFrom !== undefined && (
                    <div className="text-[10px] font-semibold text-red-600">
                      {s.infeasibleFrom == null
                        ? `⚠ can't be funded this month — not enough cash comes in`
                        : `⚠ can't be funded until day ${s.infeasibleFrom} — this step will run late`}
                    </div>
                  )}
                </div>

                <span className={`shrink-0 tabular-nums ${s.done ? "text-slate-400 line-through" : urgent ? "font-semibold text-red-700" : "text-slate-700"}`}>{formatINR(s.amount)}</span>

                {/* action */}
                <span className="flex w-16 shrink-0 justify-end">
                  {isPiggy ? (
                    <span className="text-[9px] text-slate-300">est.</span>
                  ) : isAdvance ? (
                    s.advanceId != null && canActTransfer ? (
                      <form action={s.done ? unsettleAdvance : markAdvanceSettled}><input type="hidden" name="id" value={s.advanceId} /><MiniBtn primary={!s.done}>{s.done ? "undo" : "✓ sent"}</MiniBtn></form>
                    ) : null
                  ) : isAllowance ? (
                    s.billId != null && canActAllowance ? (
                      <form action={toggleBillPaid}><input type="hidden" name="id" value={s.billId} /><MiniBtn primary={!s.done}>{s.done ? "undo" : "✓ sent"}</MiniBtn></form>
                    ) : null
                  ) : isTransfer ? (
                    s.done ? (
                      canActTransfer && s.recordId != null ? (
                        <form action={unsettle}><input type="hidden" name="id" value={s.recordId} /><MiniBtn>undo</MiniBtn></form>
                      ) : null
                    ) : canActTransfer ? (
                      <form action={markSettled}>
                        <input type="hidden" name="householdId" value={householdId} />
                        <input type="hidden" name="periodId" value={periodId} />
                        <input type="hidden" name="fromMemberId" value={s.fromId} />
                        <input type="hidden" name="toMemberId" value={s.toId} />
                        <input type="hidden" name="amount" value={s.amount} />
                        <MiniBtn primary>mark done</MiniBtn>
                      </form>
                    ) : null
                  ) : s.fund && !s.done ? (
                    <PayBillModal categoryId={s.categoryId!} periodId={periodId} name={s.vendor!} bill={s.amount} fund={s.fundAvail ?? 0} generalPiggy={generalPiggy} />
                  ) : s.billId != null && canActBill ? (
                    <form action={toggleBillPaid}><input type="hidden" name="id" value={s.billId} /><MiniBtn primary={!s.done}>{s.done ? "undo" : "✓ paid"}</MiniBtn></form>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
        </>
      )}

      {/* Per-step balances — a mobile-friendly bottom sheet: everyone's running cash right after the
          tapped step, so you can see who's holding money and could pay elsewhere. */}
      {balances && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setBalances(null)}>
          <div
            className="w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-800">Cash after step {balances.n}</h3>
                <p className="truncate text-[11px] text-slate-400">{stepTitle(balances.s)}</p>
              </div>
              <button type="button" onClick={() => setBalances(null)} className="shrink-0 rounded-md px-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
            </div>
            <p className="mt-2 text-[10px] text-slate-400">Everyone&apos;s cash in hand, from each person&apos;s own income as the plan runs to here — <b>before → after</b> this step. The people moving money are highlighted. − = short / already fronted.</p>
            <div className="mt-2 flex items-center justify-end gap-6 px-2 text-[9px] uppercase tracking-wide text-slate-300">
              <span>before</span><span>after</span>
            </div>
            <ul className="mt-0.5 space-y-1">
              {members.map((m) => {
                const before = balances.s.balancesBefore?.[m.id] ?? 0;
                const after = balances.s.balancesAfter?.[m.id] ?? 0;
                const acting = m.id === balances.s.fromId || m.id === balances.s.payerId || m.id === balances.s.toId;
                return (
                  <li key={m.id} className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${acting ? "bg-slate-50" : ""}`}>
                    <span className={acting ? "font-semibold text-slate-800" : "text-slate-600"}>{m.name}</span>
                    <span className="flex items-center gap-2 tabular-nums text-xs">
                      <span className="text-slate-400">{formatINR(before)}</span>
                      <span className="text-slate-300">→</span>
                      <span className={`w-20 text-right ${after < -0.005 ? "font-semibold text-red-600" : after > 0.005 ? "font-medium text-emerald-700" : "text-slate-400"}`}>{formatINR(after)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

// Human label for a step (shared by the row + the balances sheet).
function stepTitle(s: MoneyPlanResult["steps"][number]): string {
  if (s.kind === "allowance") return `Personal expense → ${s.toName}`;
  if (s.kind === "piggy") return `${s.fromName} → ${s.toName} · Piggy`;
  if (s.kind === "bill") return `${s.payerName} → ${s.vendor}`;
  return `${s.fromName} → ${s.toName}`;
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${active ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
    >
      {children}
    </button>
  );
}

function MiniBtn({ children, primary }: { children: React.ReactNode; primary?: boolean }) {
  return (
    <button type="submit" className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${primary ? "bg-emerald-600 text-white hover:bg-emerald-700" : "border border-slate-200 text-slate-400 hover:border-slate-300"}`}>
      {children}
    </button>
  );
}

function DayTag({ kind, day, status, days }: { kind: string; day: number | null; status: "overdue" | "soon" | "normal" | null; days: number | null }) {
  if (kind === "transfer-out" || kind === "allowance") return <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">after collection</span>;
  // No due date set = lowest priority (shown last). Make that explicit rather than blank.
  if (day == null) return <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">no date</span>;
  const ord = `${day}${["th", "st", "nd", "rd"][((day % 100) - 20) % 10] ?? ["th", "st", "nd", "rd"][day % 100] ?? "th"}`;
  if (status === "overdue") {
    const late = days != null ? Math.abs(days) : 0;
    return <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">overdue{late > 0 ? ` ${late}d` : ""} · was {ord}</span>;
  }
  // Due TODAY = red (needs action now), same urgency as overdue.
  if (status === "soon" && days === 0) {
    return <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">due today</span>;
  }
  // Due in 1–2 days = amber.
  if (status === "soon") {
    const when = days === 1 ? "due tomorrow" : days != null ? `in ${days}d` : `by ${ord}`;
    return <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{when}</span>;
  }
  return <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">by {ord}</span>;
}
