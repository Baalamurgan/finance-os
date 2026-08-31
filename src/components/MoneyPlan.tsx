"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatINR } from "@/lib/format";
import { markSettled, unsettle, toggleBillPaid, markAdvanceSettled, unsettleAdvance, markPiggyHandedOver, toggleIncomeReceived, addManualStep, deleteManualStep, toggleManualStepDone, hideStep, unhideStep, unpayMiscBill } from "@/app/actions";
import { PayBillModal } from "@/components/PayBillModal";
import { MiscPayModal } from "@/components/MiscPayModal";
import { ExpenseModal } from "@/components/ExpenseModal";
import { StepDayEditor } from "@/components/StepDayEditor";
import { useToast } from "@/components/Toast";
import type { MoneyPlanResult } from "@/lib/queries";

// The shared, everyone-visible Money Plan: the month's transfers + bill payments as one ordered,
// dated checklist. Ticking a step writes through to the real record (settlement / bill paid) — the
// action itself enforces "head or the two parties involved". Done steps strike through in green.
// A member filter narrows to just one person's remaining to-dos (keeping each step's real number);
// Refresh re-pulls due dates + amounts from Setup into this month, then re-orders the plan.
export function MoneyPlan({
  plan, householdId, periodId, isHead, currentMemberId, canEdit, open, datesEditable = false, generalPiggy,
  billCategories, members, monthBalance,
}: {
  plan: MoneyPlanResult;
  householdId: number;
  periodId: number;
  isHead: boolean;
  currentMemberId: number | null;
  canEdit: boolean;
  open: boolean;
  // Dates can be edited in the OPEN month AND the next-month PREVIEW draft (so the head can pre-arrange
  // the plan). Ticking steps stays open-only (`open`); this only unlocks the date editors.
  datesEditable?: boolean;
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
  // Add-a-step modal: open with the anchor (the step id it goes AFTER; null = top of the list).
  const [insert, setInsert] = useState<{ anchor: string | null } | null>(null);
  const treasurerId = plan.treasurerId;

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
  // every step they're part of — done ones too, so the filter is a full picture, not just to-dos.
  const rows = plan.steps.map((s, i) => ({ s, n: i + 1 }));
  const shown = who == null
    ? rows
    : rows.filter(({ s }) => s.fromId === who || s.toId === who || s.payerId === who);
  const whoName = people.find((p) => p.id === who)?.name;
  // Steps are already in display order (sorted by day). Group them under a date heading: a new heading
  // starts whenever the day changes from the previous visible step (undated steps share a "no date" head).
  const visibleRows = shown.filter(({ s }) => !s.hidden);

  // Money-plan refresh re-derives the STEPS from the current Sheet — it does NOT pull from Setup or
  // touch Sheet lines (that's the Sheet's own refresh). Done steps stay done (their state is persisted);
  // only the not-yet-done steps re-arrange to match the Sheet. So it's just a server re-render.
  const refresh = () =>
    startTransition(async () => {
      router.refresh();
      toast("Plan refreshed from the Sheet", "success");
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
          {canEdit && open && who == null && <InsertHere onClick={() => setInsert({ anchor: null })} />}
          {visibleRows.map(({ s, n }, i) => {
            // A date heading precedes the first step of each new day (income "up front" at the top,
            // undated bills/piggy "no date" at the bottom) so same-day steps read as one dated group.
            const prev = i > 0 ? visibleRows[i - 1].s : null;
            const newDateGroup = i === 0 || (prev?.day ?? null) !== (s.day ?? null);
            const isAllowance = s.kind === "allowance";
            const isPiggy = s.kind === "piggy";
            const isAdvance = s.kind === "advance";
            const isTransfer = s.kind === "transfer-in" || s.kind === "transfer-out";
            const isIncome = s.kind === "income";
            const isManual = s.kind === "manual";
            const isKept = s.kind === "kept";
            const canActManual = open && (canEdit || currentMemberId === s.fromId || currentMemberId === s.toId);
            const canActTransfer = open && (isHead || currentMemberId === s.fromId || currentMemberId === s.toId);
            const canActBill = open && (canEdit || currentMemberId === s.payerId);
            const canActAllowance = open && (canEdit || currentMemberId === s.fromId || currentMemberId === s.toId);
            const canActIncome = open && (isHead || currentMemberId === s.toId); // owner of the income (or head) ticks it received
            // Allowance = hub → member; the "personal · from hub" tag beside the title conveys the
            // kind, so the title just shows the money flow (sender → recipient) like every other step.
            // Income = a member's own money landing (recipient · source), an inflow row.
            const isHandover = isPiggy && s.handoverPeriodId != null;
            const title = isIncome ? `${s.toName ?? "?"} · ${s.source ?? "income"}` : isKept ? `Keep with ${s.toName ?? "?"}` : isAllowance ? `${s.fromName} → ${s.source ?? s.toName}` : isHandover ? `${s.fromName ?? "Owner"} → ${s.toName}` : isPiggy ? `${s.fromName} → ${s.toName} · Piggy` : isManual || isAdvance || isTransfer ? `${s.fromName} → ${s.toName}` : `${s.payerName} → ${s.vendor}`;
            // Urgency (only while unpaid — a done step is never "overdue"): RED for overdue OR due
            // today (needs action now), AMBER for due in 1–2 days, plain otherwise.
            const urgent = !s.done && (s.status === "overdue" || (s.status === "soon" && (s.days ?? 1) <= 0));
            const soon = !s.done && s.status === "soon" && (s.days ?? 0) > 0;
            // Who moves cash in this step (before → after): a bill's payer; a transfer's both sides.
            // Fund bills draw the sinking fund (no cash), so nobody's balance moves — nothing to show.
            const cashParties: { id: number; name: string }[] = (
              s.kind === "bill"
                ? (s.fund ? [] : [{ id: s.payerId, name: s.payerName }])
                : isKept // a kept earmark moves no cash in the walk — the money arrives via the normal flow
                ? []
                : [{ id: s.fromId, name: s.fromName }, { id: s.toId, name: s.toName }]
            ).filter((p): p is { id: number; name: string } => p.id != null && p.name != null);
            const short = s.senderShort ?? s.short; // member shortfall OR treasurer(hub) shortfall
            // Fronting: marking a step paid while its sender is short (earlier steps not done) means they
            // pay from their own pocket. That's allowed — they're already owed it back (their funding step
            // / settlement covers it, so the books stay balanced); we just confirm it so it's deliberate.
            const frontName = isPiggy || isTransfer || isAllowance || isAdvance ? s.fromName : s.payerName;
            const frontMsg = !s.done && short != null && short > 0.005
              ? `⚠ ${frontName ?? "This person"} is short ${formatINR(short)} right now — earlier steps aren't done yet.\n\nMarking this paid means ${frontName ?? "they"} front ${formatINR(short)} from their own pocket. That's fine — they're already owed it back (their funding step / settlement covers it, so the books stay balanced). It'll come back once that funding step is done.\n\nProceed?`
              : null;
            const confirmFront = (e: React.FormEvent) => { if (frontMsg && !confirm(frontMsg)) e.preventDefault(); };

            return (
              <Fragment key={s.id}>
              {newDateGroup && <DateGroupHeader day={s.day} kind={s.kind} />}
              <li className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs ${s.done ? "bg-emerald-50/50" : isIncome ? "bg-emerald-50/40" : isManual ? "bg-cyan-50/50" : urgent ? "bg-red-50" : soon ? "bg-amber-50" : "bg-slate-50"}`}>
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
                    {isIncome && <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600">↓ income in hand</span>}
                    {isManual && <span className="shrink-0 rounded-full bg-cyan-50 px-1.5 py-0.5 text-[9px] font-medium text-cyan-600">✎ manual</span>}
                    {isAllowance && <span className="shrink-0 rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-500">personal · from hub</span>}
                    {isPiggy && <span className="shrink-0 rounded-full bg-pink-50 px-1.5 py-0.5 text-[9px] font-medium text-pink-500">{isHandover ? "🐷 last month’s leftovers → holder" : "🐷 to piggy · at wind-down"}</span>}
                    {isKept && <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600" title={`Held by ${s.toName ?? "them"} — already counted in their in-hand; the cash reaches them via the normal collection/disbursement`}>📌 kept{s.source ? ` · ${s.source}` : ""}</span>}
                    {/* Manual steps own their day and can edit it in ANY state (it's ad-hoc metadata;
                        position still follows the insert anchor). Handled here so it's not gated by !done. */}
                    {isManual && (() => {
                      const tag = <DayTag kind="manual" day={s.day} status={null} days={null} />;
                      if (!isHead || !datesEditable || s.manualId == null) return s.day != null ? tag : null;
                      return <StepDayEditor kind="manual" id={s.manualId} day={s.day}>{tag}</StepDayEditor>;
                    })()}
                    {!isManual && !s.done && (!isPiggy || isHandover) && (() => {
                      const tag = <DayTag kind={s.kind} day={s.day} status={s.status ?? null} days={s.days ?? null} />;
                      if (!isHead || !datesEditable) return tag;
                      // Row-backed steps → edit the row's day (+ pin): bill/allowance line, income entry,
                      // advance, and a 📌 kept earmark (its ExpenseEntry id, edited like a bill line).
                      const rowId = s.kind === "income" ? s.incomeId : (s.kind === "bill" && !s.fund) || isAllowance || isKept ? s.billId : isAdvance ? s.advanceId : undefined;
                      if (rowId != null) {
                        const editKind = isAdvance ? (s.payback ? "advance-payback" : "advance") : isKept ? "bill" : s.kind;
                        return <StepDayEditor kind={editKind} id={rowId} day={s.day}>{tag}</StepDayEditor>;
                      }
                      // Rowless steps → a per-month override keyed by a stable step key: a fund/periodic
                      // bill (no line of its own) and the Piggy hand-over (date otherwise derived).
                      const stepKey = isHandover && s.handoverPeriodId != null && s.fromId != null
                        ? `piggyho-${s.handoverPeriodId}-${s.fromId}`
                        : s.kind === "bill" && s.fund && s.categoryId != null
                          ? `fund-${s.categoryId}`
                          : undefined;
                      if (stepKey) return <StepDayEditor kind="override" id={periodId} stepKey={stepKey} day={s.day}>{tag}</StepDayEditor>;
                      // Everything else (collections / disbursements) derives its date — read-only.
                      return tag;
                    })()}
                    {/* A done step keeps its date visible — when it was scheduled / due — as a muted tag,
                        plus a "paid <day>" tag when it was actually paid on a DIFFERENT day than due. */}
                    {!isManual && s.done && s.day != null && (!isPiggy || isHandover) && (
                      <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-400 no-underline">{isIncome ? "on" : "was due"} {ordinal(s.day)}</span>
                    )}
                    {s.done && s.paidDay != null && s.paidDay !== s.day && (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 no-underline">paid {ordinal(s.paidDay)}</span>
                    )}
                    {s.feedsBills && !s.done && <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-medium text-indigo-500">funds bills ↓</span>}
                    {s.fundsMember && !s.done && !s.reimbursement && <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600">funds {s.toName} ↓</span>}
                    {s.reimbursement && <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600" title={`${s.toName} is paid back early for what they spent out of pocket last month`}>reimbursement · last month’s spends</span>}
                    {s.reroute && !s.done && <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600" title="Paid directly, skipping the treasurer, because the hub can't fund it in time">direct · skips hub</span>}
                    {s.deferred && <span className="shrink-0 rounded-full bg-sky-50 px-1.5 py-0.5 text-[9px] font-medium text-sky-600" title="Added during the wind-down window — paid by the assignee at wind-down, kept out of this month's settlement">settles at wind-down</span>}
                    {isAdvance && !s.payback && <span className="shrink-0 rounded-full bg-teal-50 px-1.5 py-0.5 text-[9px] font-medium text-teal-600" title={`${s.fromName} fronts this so ${s.toName} can pay the next step`}>advance · funds {s.toName}</span>}
                    {isAdvance && s.payback && <span className="shrink-0 rounded-full bg-teal-50 px-1.5 py-0.5 text-[9px] font-medium text-teal-600" title={`${s.fromName} repays ${s.toName} the advance, now that their income has landed`}>payback → {s.toName}</span>}
                  </div>
                  {/* Cash before → after — but NOT for the Piggy hand-over: it moves LAST month's leftover
                      (a separate bucket tracked in In-Hand), not this month's cash, so those running
                      balances legitimately don't change. Showing them would read as "nothing moved". */}
                  {!s.done && cashParties.length > 0 && !isPiggy && (
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
                  {!s.done && isHandover && (
                    <div className="mt-0.5 text-[10px] text-amber-600">
                      🐷 Last month’s Piggy → {s.toName}’s once ticked · separate bucket, doesn’t move this month’s cash
                    </div>
                  )}
                  {/* Hand-over CTA/badge lives here in the (wrapping) content column — its label is too wide
                      for the cramped w-16 action slot, where it would overlap the amount. */}
                  {isHandover && s.done && (
                    <span className="mt-1 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 no-underline">✓ handed over</span>
                  )}
                  {isHandover && !s.done && canEdit && (
                    <form action={markPiggyHandedOver} className="mt-1">
                      <input type="hidden" name="periodId" value={s.handoverPeriodId} />
                      <MiniBtn primary>✓ mark handed over</MiniBtn>
                    </form>
                  )}
                  {!s.done && short != null && short > 0.005 && (
                    <div className="text-[10px] font-semibold text-red-600">
                      ⚠ {isPiggy || isTransfer || isAllowance || isAdvance ? s.fromName : s.payerName} needs {formatINR(short)} more in hand first
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

                <span className={`shrink-0 tabular-nums ${s.done ? "text-slate-400 line-through" : isIncome ? "font-medium text-emerald-600" : urgent ? "font-semibold text-red-700" : "text-slate-700"}`}>{isIncome ? "+" : ""}{formatINR(s.amount)}</span>

                {/* action */}
                <span className="flex w-16 shrink-0 justify-end">
                  {isHandover ? null /* rendered inline in the content column above */ : isPiggy ? (
                    <span className="text-[9px] text-slate-300">est.</span>
                  ) : isAdvance ? (
                    s.advanceId != null && canActTransfer ? (
                      <form action={s.done ? unsettleAdvance : markAdvanceSettled} onSubmit={confirmFront}>
                        <input type="hidden" name="id" value={s.advanceId} />
                        {s.payback && <input type="hidden" name="leg" value="payback" />}
                        <MiniBtn primary={!s.done}>{s.done ? "undo" : s.payback ? "✓ repaid" : "✓ sent"}</MiniBtn>
                      </form>
                    ) : null
                  ) : isAllowance ? (
                    s.billId != null && canActAllowance ? (
                      <form action={toggleBillPaid} onSubmit={confirmFront}><input type="hidden" name="id" value={s.billId} /><MiniBtn primary={!s.done}>{s.done ? "undo" : "✓ sent"}</MiniBtn></form>
                    ) : null
                  ) : isTransfer ? (
                    s.done ? (
                      canActTransfer && s.recordId != null ? (
                        <form action={unsettle}><input type="hidden" name="id" value={s.recordId} /><MiniBtn>undo</MiniBtn></form>
                      ) : null
                    ) : canActTransfer ? (
                      <form action={markSettled} onSubmit={confirmFront}>
                        <input type="hidden" name="householdId" value={householdId} />
                        <input type="hidden" name="periodId" value={periodId} />
                        <input type="hidden" name="fromMemberId" value={s.fromId} />
                        <input type="hidden" name="toMemberId" value={s.toId} />
                        <input type="hidden" name="amount" value={s.amount} />
                        <input type="hidden" name="key" value={s.id} />
                        <MiniBtn primary>mark done</MiniBtn>
                      </form>
                    ) : null
                  ) : isManual ? (
                    s.manualId != null && canActManual ? (
                      <form action={toggleManualStepDone}><input type="hidden" name="id" value={s.manualId} /><MiniBtn primary={!s.done}>{s.done ? "undo" : "✓ done"}</MiniBtn></form>
                    ) : null
                  ) : isIncome ? (
                    s.incomeId != null && canActIncome ? (
                      <form action={toggleIncomeReceived}><input type="hidden" name="id" value={s.incomeId} /><MiniBtn primary={!s.done}>{s.done ? "undo" : "✓ received"}</MiniBtn></form>
                    ) : null
                  ) : (s.fund || s.billId != null) ? (
                    // Bill steps only become payable once the month is OPEN and you're the head or the
                    // bill's own payer. Before the month starts (preview draft) or for someone else's
                    // bill, show a muted "to be paid" placeholder instead of an active control.
                    !canActBill ? (
                      s.done ? null : <span className="text-[9px] text-slate-300">to be paid</span>
                    ) : s.fund && !s.done ? (
                      <PayBillModal categoryId={s.categoryId!} periodId={periodId} name={s.vendor!} bill={s.amount} fund={s.fundAvail ?? 0} generalPiggy={generalPiggy} />
                    ) : s.misc && s.billId != null ? (
                      // Planned misc = estimate → actual-amount + Piggy-reconcile popup (undo reverses it).
                      s.done ? (
                        <form action={unpayMiscBill}><input type="hidden" name="id" value={s.billId} /><MiniBtn>undo</MiniBtn></form>
                      ) : (
                        <MiscPayModal id={s.billId} name={s.vendor!} estimate={s.amount} generalPiggy={generalPiggy} />
                      )
                    ) : s.billId != null ? (
                      <form action={toggleBillPaid} onSubmit={confirmFront}><input type="hidden" name="id" value={s.billId} /><MiniBtn primary={!s.done}>{s.done ? "undo" : "✓ paid"}</MiniBtn></form>
                    ) : null
                  ) : null}
                </span>

                {/* delete: manual steps are removed outright; derived steps are hidden from the plan view */}
                {canEdit && open && who == null && (
                  isManual ? (
                    <form action={deleteManualStep} className="shrink-0"><input type="hidden" name="id" value={s.manualId} /><button title="Delete this step" className="px-0.5 text-sm text-slate-300 hover:text-red-600">✕</button></form>
                  ) : (
                    <form action={hideStep} className="shrink-0"><input type="hidden" name="periodId" value={periodId} /><input type="hidden" name="stepKey" value={s.id} /><button title="Remove from plan (keeps the underlying bill/income)" className="px-0.5 text-sm text-slate-300 hover:text-red-600">✕</button></form>
                  )
                )}
              </li>
              {canEdit && open && who == null && <InsertHere onClick={() => setInsert({ anchor: s.id })} />}
              </Fragment>
            );
          })}
        </ol>

        {/* hidden (removed) steps — listed so they can be brought back; they move no cash while hidden */}
        {plan.steps.some((s) => s.hidden) && (
          <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60">
            <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-slate-500">Hidden steps ({plan.steps.filter((s) => s.hidden).length}) — removed from this plan</summary>
            <ul className="space-y-1 px-3 pb-2">
              {plan.steps.filter((s) => s.hidden).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-xs text-slate-400">
                  <span className="truncate line-through">{stepTitle(s)}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums">{formatINR(s.amount)}</span>
                    {canEdit && open && (
                      <form action={unhideStep}><input type="hidden" name="periodId" value={periodId} /><input type="hidden" name="stepKey" value={s.id} /><button className="font-medium text-emerald-600 hover:underline">un-hide</button></form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        </>
      )}

      {/* Add-a-step modal: a real member↔member (or ↔ hub) move, inserted at the chosen spot. */}
      {insert && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setInsert(null)}>
          <div className="w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Add a step</h3>
            <form action={addManualStep} onSubmit={() => setInsert(null)} className="space-y-2.5">
              <input type="hidden" name="periodId" value={periodId} />
              <input type="hidden" name="afterStepKey" value={insert.anchor ?? ""} />
              <label className="block text-[11px] font-medium text-slate-500">From
                <select name="fromMemberId" required defaultValue="" className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm">
                  <option value="" disabled>Sender…</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === treasurerId ? " (Hub)" : ""}</option>)}
                </select>
              </label>
              <label className="block text-[11px] font-medium text-slate-500">To
                <select name="toMemberId" required defaultValue="" className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm">
                  <option value="" disabled>Receiver…</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === treasurerId ? " (Hub)" : ""}</option>)}
                </select>
              </label>
              <div className="flex gap-2">
                <label className="block flex-1 text-[11px] font-medium text-slate-500">Amount
                  <input name="amount" type="number" step="0.01" min="0" required placeholder="₹" className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
                </label>
                <label className="block w-28 text-[11px] font-medium text-slate-500">Day
                  <input name="day" type="number" min="1" max="31" placeholder="of month" className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setInsert(null)} className="rounded-md px-3 py-1.5 text-sm text-slate-500">Cancel</button>
                <button className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Add step</button>
              </div>
            </form>
          </div>
        </div>
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
                // A contributor's leftover cash ≈ what they fronted out-of-pocket last month — they keep
                // their surplus instead of remitting it, which repays them. Flag it on the LAST step so
                // the ending balance doesn't read as unexplained "money they keep forever".
                const reimb = plan.reimburseByMember?.[m.id] ?? 0;
                const isLastStep = balances.n === rows.length;
                const explainsReimburse = isLastStep && m.id !== treasurerId && reimb > 0.005 && Math.abs(after - reimb) <= 1;
                return (
                  <li key={m.id} className={`rounded-md px-2 py-1.5 text-sm ${acting ? "bg-slate-50" : ""}`}>
                    <div className="flex items-center justify-between">
                      <span className={acting ? "font-semibold text-slate-800" : "text-slate-600"}>{m.name}</span>
                      <span className="flex items-center gap-2 tabular-nums text-xs">
                        <span className="text-slate-400">{formatINR(before)}</span>
                        <span className="text-slate-300">→</span>
                        <span className={`w-20 text-right ${after < -0.005 ? "font-semibold text-red-600" : after > 0.005 ? "font-medium text-emerald-700" : "text-slate-400"}`}>{formatINR(after)}</span>
                      </span>
                    </div>
                    {explainsReimburse && (
                      <p className="mt-0.5 text-[10px] text-emerald-600">≈ repays what {m.name} spent out of pocket last month — kept instead of remitted</p>
                    )}
                  </li>
                );
              })}
            </ul>
            {/* Jump to the full who-owes-whom breakdown — where each person's net (and the spends folding
                into it, e.g. a net-payer's reimbursement) is itemised line by line. */}
            <Link
              href="/settlement"
              onClick={() => setBalances(null)}
              className="mt-3 flex items-center justify-center gap-1 rounded-md border border-slate-200 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              See the full breakdown in Settlement →
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

// Human label for a step (shared by the row + the balances sheet).
function stepTitle(s: MoneyPlanResult["steps"][number]): string {
  if (s.kind === "income") return `${s.toName ?? "?"} · ${s.source ?? "income"}`;
  if (s.kind === "kept") return `Keep with ${s.toName ?? "?"}${s.source ? ` · ${s.source}` : ""}`;
  if (s.kind === "allowance") return `${s.fromName} → ${s.source ?? s.toName}`;
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

// A slim "+" sitting between two rows — click to insert a manual step right there.
// A date heading above a group of same-day steps. Dated → the ordinal day (e.g. "5th"); undated income/
// collections at the top → "Up front"; anything else undated (sinks to the bottom) → "No set date".
function DateGroupHeader({ day, kind }: { day: number | null; kind: MoneyPlanResult["steps"][number]["kind"] }) {
  const label =
    day != null ? `📅 ${ordinal(day)}` : kind === "income" || kind === "transfer-in" ? "⬆︎ Up front" : "🗓 No set date";
  return (
    <li className="list-none pt-2.5 first:pt-0">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>
    </li>
  );
}

function InsertHere({ onClick }: { onClick: () => void }) {
  return (
    <li className="list-none">
      <div className="flex items-center justify-center py-0.5">
        <button
          type="button"
          onClick={onClick}
          title="Insert a step here"
          className="grid h-5 w-5 place-items-center rounded-full border border-dashed border-slate-300 text-sm leading-none text-slate-400 opacity-40 transition hover:border-emerald-400 hover:text-emerald-600 hover:opacity-100"
        >
          +
        </button>
      </div>
    </li>
  );
}

function MiniBtn({ children, primary }: { children: React.ReactNode; primary?: boolean }) {
  return (
    <button type="submit" className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${primary ? "bg-emerald-600 text-white hover:bg-emerald-700" : "border border-slate-200 text-slate-400 hover:border-slate-300"}`}>
      {children}
    </button>
  );
}

function ordinal(day: number) {
  return `${day}${["th", "st", "nd", "rd"][((day % 100) - 20) % 10] ?? ["th", "st", "nd", "rd"][day % 100] ?? "th"}`;
}

function DayTag({ kind, day, status, days }: { kind: string; day: number | null; status: "overdue" | "soon" | "normal" | null; days: number | null }) {
  const ord = day == null ? null : ordinal(day);
  // Income lands ON a day (or "up front" if undated) — it's an arrival, not a deadline.
  if (kind === "income") return <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600">{ord ? `on ${ord}` : "up front"}</span>;
  // Disbursements (hub → member) go out once the hub has collected enough. They're scheduled to a
  // real target day (reimburse-day, or the day a funded bill falls due) — show it as "by <day>", and
  // only fall back to "after collection" when there's genuinely no date (the month-end residual).
  if (kind === "transfer-out" || kind === "allowance") return <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">{ord ? `by ${ord}` : "after collection"}</span>;
  // No due date set = lowest priority (shown last). Make that explicit rather than blank.
  if (day == null) return <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">no date</span>;
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
