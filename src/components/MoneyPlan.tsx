"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatINR } from "@/lib/format";
import { toggleStepGroup, markSettled, unsettle, toggleBillPaid, markAdvanceSettled, unsettleAdvance, markPiggyHandedOver, toggleIncomeReceived, addManualStep, deleteManualStep, toggleManualStepDone, hideStep, unhideStep, unpayMiscBill, togglePoolHandover, togglePiggyHandover, moveStep, unpayFamilyCardBill } from "@/app/actions";
import { PayBillModal } from "@/components/PayBillModal";
import { PayCardBillModal } from "@/components/PayCardBillModal";
import { MiscPayModal } from "@/components/MiscPayModal";
import { ExpenseModal } from "@/components/ExpenseModal";
import { AddSpendModal } from "@/components/AddSpendModal";
import { StepDayEditor } from "@/components/StepDayEditor";
import { StepAmountEditor } from "@/components/StepAmountEditor";
import { LendModal } from "@/components/LendModal";
import { useToast, useToastAction } from "@/components/Toast";
import type { MoneyPlanResult } from "@/lib/queries";
import { canActOnStep, canActInMonth } from "@/lib/planAuth";
import { CTA_CLASS, CtaLabel } from "@/components/Cta";
import { isPaybackNote, isLendGroup, isPoolLendGroup, isRefundGroup } from "@/lib/notes";

// The shared, everyone-visible Money Plan: the month's transfers + bill payments as one ordered,
// dated checklist. Ticking a step writes through to the real record (settlement / bill paid) — the
// action itself enforces "head or the two parties involved". Done steps strike through in green.
// A member filter narrows to just one person's remaining to-dos (keeping each step's real number);
// Refresh re-pulls due dates + amounts from Setup into this month, then re-orders the plan.
export function MoneyPlan({
  plan, householdId, periodId, isHead, currentMemberId, canEdit, open, datesEditable = false, generalPiggy,
  billCategories, spendCategories = [], members, monthBalance, cardsByMember = {}, currentDay = null,
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
  spendCategories?: { id: number; name: string }[]; // tracked family categories — where a card bill's extra charge / cashback is booked
  members: { id: number; name: string }[];
  monthBalance: number;
  // Each member's own credit cards → the "Paid with" picker on their bills' Pay modals.
  cardsByMember?: Record<number, { id: number; name: string; last4: string | null; color: string }[]>;
  // Today's day-of-month (IST) when viewing the CURRENT month, else null — the one date left expanded.
  currentDay?: number | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const withToast = useToastAction();
  const [pending, startTransition] = useTransition();
  // Default the filter to the viewer's OWN steps (they mostly care about what they must do), falling
  // back to Everyone if they're not part of any step this month. They can switch to Everyone any time.
  const [who, setWho] = useState<number | null>(() =>
    currentMemberId != null && plan.steps.some((s) => s.fromId === currentMemberId || s.toId === currentMemberId || s.payerId === currentMemberId)
      ? currentMemberId
      : null
  );
  const [addOpen, setAddOpen] = useState(false);
  const [balances, setBalances] = useState<{ s: MoneyPlanResult["steps"][number]; n: number } | null>(null);
  // A short bill the head is BRIDGING (repayable, via the hub) — payer's own income lands later.
  const [bridge, setBridge] = useState<MoneyPlanResult["steps"][number] | null>(null);
  // Days (keyed by day number / "none") the viewer has FLIPPED from their default fold state.
  const [toggledDays, setToggledDays] = useState<Set<string>>(new Set());
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
  // Vendor of each bill step, so a funding move (funder → payer, tagged to a bill) can name what it funds.
  const billVendorByKey = new Map(plan.steps.filter((s) => s.kind === "bill" && s.vendor).map((s) => [s.id, s.vendor as string]));
  const shown = who == null
    ? rows
    : rows.filter(({ s }) => s.fromId === who || s.toId === who || s.payerId === who);
  const whoName = people.find((p) => p.id === who)?.name;
  // Steps are already in display order (sorted by day). Group them under a date heading: a new heading
  // starts whenever the day changes from the previous visible step (undated steps share a "no date" head).
  const visibleRows = shown.filter(({ s }) => !s.hidden);
  // GROUP same-day moves between the same two people (e.g. Arumugam → Harish funding two bills + a payback)
  // into ONE row "A → B ₹total" with a breakdown of what it's for — one real transfer, one tap. Only
  // back-to-back pool/manual moves in the same state group (bridge legs and budget loans stay on their own:
  // they carry repay-by rules). Each piece keeps its own record underneath; see toggleStepGroup.
  type Step = MoneyPlanResult["steps"][number];
  const groupable = (x: Step) => (x.kind === "transfer-out" || x.kind === "transfer-in" || x.kind === "manual") && x.fromId != null && x.toId != null && (!x.bridgeGroup || isLendGroup(x.bridgeGroup)) && !x.budgetLoan && !x.budgetPayback;
  const displayRows: { s: Step; n: number; items: { s: Step; n: number }[] }[] = [];
  for (const r of visibleRows) {
    const last = displayRows[displayRows.length - 1];
    const head = last?.items[0].s;
    if (last && head && groupable(r.s) && groupable(head) && head.day === r.s.day && head.fromId === r.s.fromId && head.toId === r.s.toId && head.done === r.s.done) {
      last.items.push(r);
      continue;
    }
    displayRows.push({ s: r.s, n: r.n, items: [r] });
  }
  for (const d of displayRows) {
    if (d.items.length < 2) continue;
    const first = d.items[0].s, lastS = d.items[d.items.length - 1].s;
    const shorts = d.items.map((x) => x.s.senderShort ?? x.s.short ?? 0);
    d.s = {
      ...first, id: `grp-${first.id}`, kind: "transfer-out", amount: Math.round(d.items.reduce((t, x) => t + x.s.amount, 0) * 100) / 100,
      balancesBefore: first.balancesBefore, balancesAfter: lastS.balancesAfter,
      senderShort: Math.max(...shorts) > 0.005 ? Math.max(...shorts) : undefined, short: undefined,
      fundsBillKey: undefined, fundsMember: false, reimbursement: undefined, reroute: false, note: undefined, manualId: undefined, recordId: null,
    } as Step;
  }
  // A bridge loan's two legs: the loan itself (lender → member, above the bill) and the pool's return of it.
  const lendLabel = (x: Step) =>
    x.fundsBillKey && isPoolLendGroup(x.bridgeGroup) ? `🌉 Covers ${billVendorByKey.get(x.fundsBillKey) ?? "a bill"} · counts toward what ${x.fromName} owes the pool`
    : x.fundsBillKey
      ? (x.fromId === treasurerId ? `↩ Early from ${x.toName}'s payout · for ${billVendorByKey.get(x.fundsBillKey) ?? "a bill"}` : `🌉 Bridges ${billVendorByKey.get(x.fundsBillKey) ?? "a bill"}${x.returnBy != null ? ` · back on the ${ordinal(x.returnBy)}` : ""}`)
      : `🌉 Returns ${x.toName}'s loan`;
  // What one piece of a grouped row is FOR (its line in the breakdown).
  const pieceLabel = (x: Step) =>
    isLendGroup(x.bridgeGroup) ? lendLabel(x)
    : x.fundsBillKey ? `💰 ${billVendorByKey.get(x.fundsBillKey) ?? "bill"}`
    : x.kind === "manual" && x.note ? (isPaybackNote(x.note) ? x.note : `✎ ${x.note}`)
    : x.reimbursement ? "↩ Reimbursement · last month’s spends"
    : x.fundsMember ? `💰 funds ${x.toName ?? ""}`.trim()
    : x.kind === "manual" ? "✎ manual move"
    : x.kind === "transfer-in" ? "📥 collection"
    : "Payout · rest of what the pool owes";

  // Every day folds into its date header (tap to expand/collapse), showing "N done" / "N pending" — so the
  // plan stays focused. ONLY today's date is expanded by default; every other day starts collapsed. Keyed
  // by day; undated → "none" (never today's date, so always collapsed by default).
  const dayKeyOf = (step: MoneyPlanResult["steps"][number]) => (step.day == null ? "none" : String(step.day));
  const dayStats = new Map<string, { total: number; done: number }>();
  for (const { s } of displayRows) {
    const e = dayStats.get(dayKeyOf(s)) ?? { total: 0, done: 0 };
    e.total++; if (s.done) e.done++;
    dayStats.set(dayKeyOf(s), e);
  }
  // Default-collapsed for every day except today; `toggledDays` flips that (XOR) so a tap on any header
  // expands/collapses it. currentDay null (not viewing the current month) → every day collapsed.
  const defaultCollapsed = (dayNum: number | null) => currentDay == null || dayNum !== currentDay;
  const isDayCollapsed = (s: MoneyPlanResult["steps"][number]) => defaultCollapsed(s.day) !== toggledDays.has(dayKeyOf(s));
  const toggleDay = (k: string) => setToggledDays((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // Money-plan refresh re-derives the STEPS from the current Sheet — it does NOT pull from Setup or
  // touch Sheet lines (that's the Sheet's own refresh). Done steps stay done (their state is persisted);
  // only the not-yet-done steps re-arrange to match the Sheet. So it's just a server re-render.
  const refresh = () =>
    startTransition(async () => {
      router.refresh();
      toast("Plan refreshed from the Sheet", "success");
    });

  // Head reorder: swap this step one slot with its neighbour (positional, NOT a date change). Persists the
  // whole order server-side and recomputes the plan in it — the list dims while it recalculates.
  // Move a row (one step, or every part of a grouped row) past the neighbouring row (which may be grouped
  // too). Anything that can't move says why in a toast — the server checks and explains every case.
  const move = (stepIds: string[], dir: "up" | "down", neighborIds: string[]) =>
    startTransition(async () => {
      if (neighborIds.length === 0) { toast(dir === "up" ? "Already the first step." : "Already the last step.", "error"); return; }
      const fd = new FormData();
      fd.set("periodId", String(periodId));
      fd.set("stepKeys", stepIds.join(","));
      fd.set("neighborKeys", neighborIds.join(","));
      fd.set("dir", dir);
      const r = await moveStep(fd);
      router.refresh();
      if (!r.ok) toast(r.error ?? "Couldn't move the step", "error");
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
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
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
        treasurerId={treasurerId ?? null}
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

      {plan.shortBills > 0 && who == null && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          ⚠️ <b>{plan.shortBills}</b> {plan.shortBills === 1 ? "bill can't" : "bills can't"} be paid on time — each shows who&apos;s short and the day it becomes payable below. Aim for zero: shift a due date later, or bring income in sooner.
        </div>
      )}

      {shown.length === 0 ? (
        <p className="rounded-lg bg-emerald-50/60 px-3 py-3 text-center text-xs text-emerald-700">
          ✓ {whoName ? `${whoName} has nothing left to do` : "Nothing left to do"} this month.
        </p>
      ) : (
        <>
        <p className="mb-1.5 text-[10px] text-slate-400">Tap any step&apos;s number <span className="mx-0.5 inline-grid h-3.5 w-3.5 place-items-center rounded-full ring-1 ring-slate-300 align-middle text-[8px]">1</span> to see everyone&apos;s cash before &amp; after it.</p>
        <ol className={`space-y-1.5 transition-opacity ${pending ? "pointer-events-none opacity-50" : ""}`} aria-busy={pending}>
          {canEdit && open && who == null && <InsertHere onClick={() => setInsert({ anchor: null })} />}
          {displayRows.map(({ s, n, items }, i) => {
            const g = items.length > 1 ? items : null; // a grouped row: same day, same two people
            // A date heading precedes the first step of each new day (income "up front" at the top,
            // undated bills/piggy "no date" at the bottom) so same-day steps read as one dated group.
            const prev = i > 0 ? displayRows[i - 1].s : null;
            const newDateGroup = i === 0 || (prev?.day ?? null) !== (s.day ?? null);
            const dayKey = dayKeyOf(s);
            const dayCollapsed = isDayCollapsed(s); // every day folds except today (tap any header to flip)
            const isAllowance = s.kind === "allowance";
            const isPiggy = s.kind === "piggy";
            const isAdvance = s.kind === "advance";
            const isTransfer = s.kind === "transfer-in" || s.kind === "transfer-out";
            const isIncome = s.kind === "income";
            const isManual = s.kind === "manual";
            const isPoolHandover = s.kind === "pool-handover";
            // A piggy-income batch ticks via togglePiggyHandover on its income ids (locks those rows); a
            // leftover hand-over ticks via togglePoolHandover on its PoolHandover row ids.
            const piggyBatch = isPoolHandover && (s.piggyIncomeIds?.length ?? 0) > 0;
            const hoIds = piggyBatch ? s.piggyIncomeIds! : (s.recordIds ?? []);
            const hoAction = piggyBatch ? togglePiggyHandover : togglePoolHandover;
            // Actor permission comes from the SHARED canActOnStep (src/lib/planAuth) that the server
            // actions also call — so the button we show can never disagree with what the server accepts.
            // The month gate is layered on here per kind (a manual peer-move is net-zero, so the HEAD may
            // correct it in a closed month via canActInMonth; transfers/bills/allowances/income stay
            // open-only in the UI). See each server action for the matching enforcement.
            const actor = { memberId: currentMemberId, isHead, canEdit };
            const canActManual = canActOnStep({ kind: "manual", fromId: s.fromId, toId: s.toId }, actor) && canActInMonth(open, isHead);
            const canActTransfer = open && canActOnStep({ kind: s.kind, fromId: s.fromId, toId: s.toId }, actor);
            const canActBill = open && canActOnStep({ kind: "bill", payerId: s.payerId }, actor);
            const canActAllowance = open && canActOnStep({ kind: "allowance", fromId: s.fromId, toId: s.toId }, actor);
            const canActIncome = open && canActOnStep({ kind: "income", ownerId: s.toId }, actor); // owner (or head/manager) ticks it received
            // Allowance = hub → member; the "personal · from hub" tag beside the title conveys the
            // kind, so the title just shows the money flow (sender → recipient) like every other step.
            // Income = a member's own money landing (recipient · source), an inflow row.
            const isHandover = isPiggy && s.handoverPeriodId != null;
            const title = isIncome ? `${s.toName ?? "?"} · ${s.source ?? "income"}` : isAllowance ? `${s.fromName} → ${s.toName}` : isHandover ? `${s.fromName ?? "Owner"} → ${s.toName}` : isPiggy ? `${s.fromName} → ${s.toName} · Piggy` : isManual || isAdvance || isTransfer || isPoolHandover ? `${s.fromName} → ${s.toName}` : `${s.payerName} → ${s.vendor}`;
            // Urgency (only while unpaid — a done step is never "overdue"): RED for overdue OR due
            // today (needs action now), AMBER for due in 1–2 days, plain otherwise.
            // Every step kind follows the same rule; a step with no server urgency gets it from its day (current month only).
            const urg = urgencyOf(s, currentDay);
            const urgent = !s.done && (urg.status === "overdue" || (urg.status === "soon" && (urg.days ?? 1) <= 0));
            const soon = !s.done && urg.status === "soon" && (urg.days ?? 0) > 0;
            // Who moves cash in this step (before → after): a bill's payer; a transfer's both sides.
            // Fund bills draw the sinking fund (no cash), so nobody's balance moves — nothing to show.
            const cashParties: { id: number; name: string }[] = (
              s.kind === "bill"
                ? (s.fund ? [] : [{ id: s.payerId, name: s.payerName }])
                : [{ id: s.fromId, name: s.fromName }, { id: s.toId, name: s.toName }]
            ).filter((p): p is { id: number; name: string } => p.id != null && p.name != null);
            const short = s.senderShort ?? s.short; // member shortfall OR treasurer(hub) shortfall
            // Fronting: marking a step paid while its sender is short (earlier steps not done) means they
            // pay from their own pocket. That's allowed — they're already owed it back (their funding step
            // / settlement covers it, so the books stay balanced); we just confirm it so it's deliberate.
            const frontName = isPiggy || isTransfer || isAllowance || isAdvance || isPoolHandover ? s.fromName : s.payerName;
            const frontMsg = !s.done && short != null && short > 0.005
              ? `⚠ ${frontName ?? "This person"} is short ${formatINR(short)} right now — earlier steps aren't done yet.\n\nMarking this paid means ${frontName ?? "they"} front ${formatINR(short)} from their own pocket. That's fine — they're already owed it back (their funding step / settlement covers it, so the books stay balanced). It'll come back once that funding step is done.\n\nProceed?`
              : null;
            const confirmFront = (e: React.FormEvent) => { if (frontMsg && !confirm(frontMsg)) e.preventDefault(); };
            // Editing a step in a CLOSED month is a retroactive correction of history — confirm it so the
            // head can't do it by accident. Only reachable for peer moves (see canActManual), which don't
            // affect carry-over, but it still rewrites that month's In-Hand ledger.
            const confirmClosed = (e: React.FormEvent) => {
              if (!open && !confirm(`This is a closed month. ${s.done ? "Un-marking this move" : "Marking this move done"} corrects that month's In-Hand to match what really happened.\n\nProceed?`)) e.preventDefault();
            };

            return (
              <Fragment key={s.id}>
              {newDateGroup && <DateGroupHeader day={s.day} kind={s.kind} collapsed={dayCollapsed} count={dayStats.get(dayKey)?.total} done={dayStats.get(dayKey)?.done} onToggle={() => toggleDay(dayKey)} />}
              {!dayCollapsed && (
              <li className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-xs ${s.done ? "bg-emerald-50/50" : isIncome ? "bg-emerald-50/40" : urgent ? "bg-red-50" : soon ? "bg-amber-50" : isManual ? "bg-cyan-50/50" : "bg-slate-50"}`}>
                <button
                  type="button"
                  onClick={() => setBalances({ s, n })}
                  title="Tap to see everyone's cash before & after this step"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-slate-500 ring-1 ring-slate-300 hover:bg-slate-200 hover:text-slate-800"
                >
                  {s.done ? <span className="text-emerald-600">✓</span> : n}
                </button>

                <div className="min-w-0 flex-1">
                  {/* Sender → receiver on its own line — never truncated; wraps to as many lines as it
                      needs so it's always fully readable on a phone. Metadata badges sit below it. */}
                  <div className={`break-words font-medium leading-snug ${s.done ? "text-slate-400 line-through" : "text-slate-800"}`}>{title}</div>
                  {g ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <DayTag kind={s.kind} day={s.day} status={urg.status} days={urg.days} done={s.done} />
                      <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">{g.length} parts · one transfer</span>
                    </div>
                  ) : (
                  <div className={`mt-1 flex flex-wrap items-center gap-1.5 empty:mt-0 ${s.done ? "text-slate-400" : "text-slate-800"}`}>
                    {isIncome && <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600">↓ income in hand</span>}
                    {isManual && <span className="shrink-0 rounded-full bg-cyan-50 px-1.5 py-0.5 text-[9px] font-medium text-cyan-600">✎ manual</span>}
                    {isAllowance && <span className="shrink-0 rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-500">personal · from hub</span>}
                    {isPiggy && <span className="shrink-0 rounded-full bg-pink-50 px-1.5 py-0.5 text-[9px] font-medium text-pink-500">{isHandover ? "🐷 last month’s leftovers → holder" : "🐷 to piggy · at wind-down"}</span>}
                    {isPoolHandover && <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600" title="Last month's money this person still holds — their budget leftover routed to income and/or the general Piggy — handed to the treasurer so the hub can run the plan">📥 last month’s money → treasurer</span>}
                    {/* Manual steps own their day and can edit it in ANY state (it's ad-hoc metadata;
                        position still follows the insert anchor). Handled here so it's not gated by !done. */}
                    {isManual && (() => {
                      const tag = <DayTag kind="manual" day={s.day} status={urg.status} days={urg.days} done={s.done} />;
                      if (!isHead || !datesEditable || s.manualId == null) return s.day != null ? tag : null;
                      return <StepDayEditor kind="manual" id={s.manualId} day={s.day} minDay={s.fundsBillKey ? plan.minEditDay : undefined} maxDay={s.fundsBillKey ? (s.disbMaxDay ?? s.day ?? undefined) : undefined}>{tag}</StepDayEditor>;
                    })()}
                    {!isManual && !s.done && (!isPiggy || isHandover) && (() => {
                      const tag = <DayTag kind={s.kind} day={s.day} status={urg.status} days={urg.days} done={s.done} />;
                      if (!isHead || !datesEditable) return tag;
                      // Row-backed steps → edit the row's day (+ pin): bill/allowance line, income entry,
                      // advance (its ExpenseEntry / IncomeEntry / advance id).
                      const rowId = s.kind === "income" ? s.incomeId : (s.kind === "bill" && !s.fund) || isAllowance ? s.billId : isAdvance ? s.advanceId : undefined;
                      if (rowId != null) {
                        const editKind = isAdvance ? (s.payback ? "advance-payback" : "advance") : s.kind;
                        return <StepDayEditor kind={editKind} id={rowId} day={s.day}>{tag}</StepDayEditor>;
                      }
                      // Rowless steps → a per-month override keyed by a stable step key: a fund/periodic
                      // bill (no line of its own) and the Piggy hand-over (date otherwise derived).
                      const stepKey = isHandover && s.handoverPeriodId != null && s.fromId != null
                        ? `piggyho-${s.handoverPeriodId}-${s.fromId}`
                        : isPoolHandover && s.fromId != null
                          ? `poolho-${s.fromId}`
                          : s.kind === "bill" && s.fund && s.categoryId != null
                            ? `fund-${s.categoryId}`
                            : undefined;
                      if (stepKey) return <StepDayEditor kind="override" id={periodId} stepKey={stepKey} day={s.day}>{tag}</StepDayEditor>;
                      // A hub funding disbursement ("funds <name> ↓"): re-datable to an EARLIER affordable day
                      // (picker goes up to the bill day; the server rejects a day the hub can't cover or that's
                      // past the bill). Keyed per creditor, so all the hub's funding to them moves together.
                      if (s.kind === "transfer-out" && s.fundsMember && !s.done && !s.budgetLoan && !s.reroute && s.toId != null)
                        return <StepDayEditor kind="override" id={periodId} stepKey={`disbday-${s.id}`} day={s.day} minDay={plan.minEditDay} maxDay={s.disbMaxDay ?? s.day ?? undefined}>{tag}</StepDayEditor>;
                      // Everything else (collections) derives its date — read-only.
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
                    {s.fundsMember && !s.done && !s.reimbursement && !s.budgetLoan && !s.fundsBillKey && <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600">funds {s.toName} ↓</span>}
                    {s.fundsBillKey && !s.bridgeGroup && <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700" title={
                      s.kind === "manual"
                        ? `${s.fromName} covers ${billVendorByKey.get(s.fundsBillKey) ?? `${s.toName}'s bill`} from pool cash they're holding — paid straight to ${s.toName}, no repayment`
                        : s.reroute
                        ? `${s.fromName} pays ${billVendorByKey.get(s.fundsBillKey) ?? `${s.toName}'s bill`} directly for ${s.toName}, skipping the hub`
                        : `The pool disburses this to ${s.toName} so they can pay ${billVendorByKey.get(s.fundsBillKey) ?? "this bill"} ↓`
                    }>💰 funds {billVendorByKey.get(s.fundsBillKey) ?? s.toName}</span>}
                    {/* Repayable bridge: the funder→debtor leg names the bill it bridges; the two pay-back
                        legs (debtor→hub, hub→funder) carry a quiet tag so the trio reads as one bridge. */}
                    {isLendGroup(s.bridgeGroup) && <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-medium text-sky-700" title={s.fundsBillKey ? `${s.fromName} covers ${s.toName}'s ${billVendorByKey.get(s.fundsBillKey) ?? "bill"} now — ${s.toName}'s later payout shrinks by it${isPoolLendGroup(s.bridgeGroup) ? `; it counts toward what ${s.fromName} owes the pool (no return)` : s.fromId !== treasurerId ? "; the pool returns it as soon as it can spare it" : ""}` : `The pool returns ${s.toName}'s bridge loan — dated to the earliest day it can spare it`}>{lendLabel(s)}</span>}
                    {s.slid && !s.done && <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-700" title="You'd moved this earlier, but the pool can't spare it there any more — it sits at the earliest point it can">↓ earliest the pool can spare it</span>}
                    {s.fundsBillKey && s.bridgeGroup && !isLendGroup(s.bridgeGroup) && <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-medium text-sky-700" title={`${s.fromName} fronts ${s.toName}'s ${billVendorByKey.get(s.fundsBillKey) ?? "bill"} — the pool repays ${s.fromName} when ${s.toName}'s income lands`}>🌉 bridges {billVendorByKey.get(s.fundsBillKey) ?? s.toName}</span>}
                    {s.bridgeGroup && !isLendGroup(s.bridgeGroup) && !isRefundGroup(s.bridgeGroup) && !s.fundsBillKey && <span className="shrink-0 rounded-full bg-sky-50 px-1.5 py-0.5 text-[9px] font-medium text-sky-600">🌉 bridge payback</span>}
                    {isRefundGroup(s.bridgeGroup) && <span className="shrink-0 rounded-full bg-rose-50 px-1.5 py-0.5 text-[9px] font-medium text-rose-600" title="Sends back money for a spend that was refunded — undo it from the refund on the Expenses page">↩ refund</span>}
                    {s.reimbursement && <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600" title={`${s.toName} is paid back early for what they spent out of pocket last month`}>reimbursement · last month’s spends</span>}
                    {s.budgetLoan && !s.done && <span className="shrink-0 rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-600" title={`${s.fromName} lends their own budget so ${s.toName}'s bill is paid on time — the hub returns it${s.returnBy != null ? ` by the ${ordinal(s.returnBy)}` : " once income lands"}`}>💜 lends budget{s.returnBy != null ? ` · back by ${ordinal(s.returnBy)}` : ""}</span>}
                    {s.budgetPayback && !s.done && <span className="shrink-0 rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-600" title={`The hub returns the budget ${s.toName} lent earlier to fund a bill on time`}>↩️ budget returned → {s.toName}</span>}
                    {s.reroute && !s.done && <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600" title="Paid straight to the person who needs it today, skipping the treasurer — one transfer instead of debtor→hub→creditor">direct · skips hub</span>}
                    {s.deferred && <span className="shrink-0 rounded-full bg-sky-50 px-1.5 py-0.5 text-[9px] font-medium text-sky-600" title="Added during the wind-down window — paid by the assignee at wind-down, kept out of this month's settlement">settles at wind-down</span>}
                    {s.cardBill && <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium" style={{ backgroundColor: `${s.cardColor ?? "#a21caf"}1a`, color: s.cardColor ?? "#a21caf" }} title="Family credit-card bill — paid from cash the owner already holds (carried budget / reimbursed), so no one's cash-in-hand below moves">💳 card bill · from held cash</span>}
                    {isAdvance && !s.payback && <span className="shrink-0 rounded-full bg-teal-50 px-1.5 py-0.5 text-[9px] font-medium text-teal-600" title={`${s.fromName} fronts this so ${s.toName} can pay the next step`}>advance · funds {s.toName}</span>}
                    {isAdvance && s.payback && <span className="shrink-0 rounded-full bg-teal-50 px-1.5 py-0.5 text-[9px] font-medium text-teal-600" title={`${s.fromName} repays ${s.toName} the advance, now that their income has landed`}>payback → {s.toName}</span>}
                  </div>
                  )}
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
                  {g && (
                    <ul className={`mt-1.5 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white px-2 text-[11px] ${s.done ? "text-slate-400" : "text-slate-700"}`}>
                      {g.map(({ s: x }) => {
                        const amt = <span className="tabular-nums">{formatINR(x.amount)}</span>;
                        const paybackLine = x.kind === "manual" && isPaybackNote(x.note);
                        const editable = !x.done && open && x.manualId != null && (paybackLine ? canEdit : isHead && datesEditable);
                        return (
                          <li key={x.id} className="flex items-center justify-between gap-2 py-1">
                            <span className="min-w-0 break-words">{pieceLabel(x)}</span>
                            <span className="flex shrink-0 items-center gap-1">
                              {editable ? <StepAmountEditor id={x.manualId!} amount={x.amount}>{amt}</StepAmountEditor> : amt}
                              {canEdit && open && who == null && !x.done && (
                                x.kind === "manual" ? (
                                  <form action={withToast(deleteManualStep, { success: "Step deleted" })}><input type="hidden" name="id" value={x.manualId} /><button title="Delete this part" className="px-0.5 text-xs text-slate-300 hover:text-red-600">✕</button></form>
                                ) : (
                                  <form action={withToast(hideStep, { success: "Removed from plan" })}><input type="hidden" name="periodId" value={periodId} /><input type="hidden" name="stepKey" value={x.id} /><button title="Remove this part from the plan" className="px-0.5 text-xs text-slate-300 hover:text-red-600">✕</button></form>
                                )
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {isManual && s.note && (!s.fundsBillKey || isLendGroup(s.bridgeGroup)) && (
                    <div className="mt-0.5 text-[10px] italic text-slate-500">📝 {s.note}</div>
                  )}
                  {/* What a disbursement is FOR — the expense label (e.g. "Harish Urbanrise cleaning reward"),
                      so "Arumugam → Harish · from hub" says what the money is for, not just who → who. */}
                  {isAllowance && s.source && (
                    <div className="mt-0.5 text-[10px] italic text-slate-500">📝 {s.source}</div>
                  )}
                  {!s.done && isHandover && (
                    <div className="mt-0.5 text-[10px] text-amber-600">
                      🐷 Last month’s Piggy → {s.toName}’s once ticked · separate bucket, doesn’t move this month’s cash
                    </div>
                  )}
                  {/* Hand-over CTA/badge lives here in the (wrapping) content column — its label is too wide
                      for the cramped w-16 action slot, where it would overlap the amount. */}
                  {isHandover && s.done && (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 no-underline">✓ handed over</span>
                      {(canEdit || currentMemberId === s.fromId || currentMemberId === s.toId) && (
                        <form action={withToast(markPiggyHandedOver, { success: "Reverted" })}>
                          <input type="hidden" name="periodId" value={s.handoverPeriodId} />
                          <input type="hidden" name="undo" value="1" />
                          <MiniBtn />
                        </form>
                      )}
                    </div>
                  )}
                  {isHandover && !s.done && (canEdit || currentMemberId === s.fromId || currentMemberId === s.toId) && (
                    <form action={withToast(markPiggyHandedOver, { success: "Marked handed over" })} className="mt-1">
                      <input type="hidden" name="periodId" value={s.handoverPeriodId} />
                      <MiniBtn primary>Sent</MiniBtn>
                    </form>
                  )}
                  {/* Pool hand-over: the wide "leftover · … + from Piggy" provenance + a combined tick. */}
                  {isPoolHandover && s.source && (
                    <div className="mt-0.5 text-[10px] text-amber-600">{s.source}</div>
                  )}
                  {isPoolHandover && s.done && (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 no-underline">✓ handed to {s.toName}</span>
                      {(canEdit || currentMemberId === s.fromId) && hoIds.length > 0 && (
                        <form action={withToast(hoAction, { success: "Hand-over undone" })}>
                          <input type="hidden" name="ids" value={hoIds.join(",")} />
                          <MiniBtn />
                        </form>
                      )}
                    </div>
                  )}
                  {isPoolHandover && !s.done && (canEdit || currentMemberId === s.fromId) && hoIds.length > 0 && (
                    <form action={withToast(hoAction, { success: "Marked handed over" })} className="mt-1">
                      <input type="hidden" name="ids" value={hoIds.join(",")} />
                      <MiniBtn primary>Sent</MiniBtn>
                    </form>
                  )}
                  {!s.done && short != null && short > 0.005 && (
                    s.kind === "bill" ? (
                      // The shortfall lives on the bill itself: the hub sends the fullest it can; whatever
                      // the payer still lacks shows here, with the day it becomes payable (funding/income in).
                      <>
                        <div className="text-[10px] font-semibold text-red-600">
                          ⚠ {s.payerName} short {formatINR(short)}
                          {s.infeasibleFrom == null
                            ? ` — not payable in full this month`
                            : ` — payable from ${ordinal(s.infeasibleFrom)}, once funding & income land`}
                        </div>
                        {/* Head funding buttons — only when a NON-hub holder actually has spare cash before
                            this bill. "Fund" = no-payback pool cash (open month). "Bridge" = repayable via
                            the hub, shown also in the preview, when the payer's OWN income lands later (so
                            there's something to square up from). */}
                        {(() => {
                          if (s.billId == null || !canEdit || !open) return null;
                          const anyCash = members.some((m) => m.id !== s.payerId && (s.balancesBefore?.[m.id] ?? 0) > 0.5);
                          if (!anyCash) return null;
                          return (
                            <div className="mt-1 flex flex-wrap gap-1">
                              <button type="button" onClick={() => setBridge(s)} className={`${CTA_CLASS.window} bg-sky-600 hover:bg-sky-700 active:bg-sky-800`} title="Someone with cash covers it now; the plan pays them back"><CtaLabel kind="window">🌉 Bridge</CtaLabel></button>
                            </div>
                          );
                        })()}
                      </>
                    ) : (
                      <div className="text-[10px] font-semibold text-red-600">
                        ⚠ {isPiggy || isTransfer || isAllowance || isAdvance || isPoolHandover ? s.fromName : s.payerName} needs {formatINR(short)} more in hand first
                      </div>
                    )
                  )}
                  {/* Fund bill: paid from the saved-up fund, not cash — so no balance moves above. Show
                      the fund draw here so the payer sees their saved money is what covers it (and a
                      warning when the fund can't cover the full bill). */}
                  {!s.done && s.kind === "bill" && s.fund && (() => {
                    const avail = s.fundAvail ?? 0;
                    const shortBy = Math.round((s.amount - avail) * 100) / 100;
                    return shortBy > 0.005 ? (
                      <div className="text-[10px] font-semibold text-amber-600">
                        🏦 {s.vendor} fund has {formatINR(avail)} of {formatINR(s.amount)} · {s.payerName} tops up {formatINR(shortBy)}
                      </div>
                    ) : (
                      <div className="text-[10px] text-indigo-500">
                        🏦 From the {s.vendor} fund · {formatINR(avail)} → {formatINR(Math.round((avail - s.amount) * 100) / 100)} left
                      </div>
                    );
                  })()}
                </div>

                {/* amount + action stacked on the right so the title column keeps its full width */}
                <div className="flex shrink-0 flex-col items-end gap-1">
                {(() => {
                  const amtSpan = <span className={`tabular-nums ${s.done ? "text-slate-400 line-through" : isIncome ? "font-medium text-emerald-600" : urgent ? "font-semibold text-red-700" : "text-slate-700"}`}>{isIncome ? "+" : ""}{formatINR(s.amount)}</span>;
                  // Head can edit a PLAIN manual move's amount inline (not bridge legs / bill-funding, not once done).
                  const amountEditable = isManual && (isPaybackNote(s.note) ? canEdit && open : isHead && datesEditable) && !s.done && s.manualId != null && !s.bridgeGroup && !s.fundsBillKey;
                  return amountEditable ? <StepAmountEditor id={s.manualId!} amount={s.amount}>{amtSpan}</StepAmountEditor> : amtSpan;
                })()}

                {/* action */}
                <span className="flex justify-end empty:hidden">
                  {g ? (() => {
                    // One tap sends (or undoes) every part. Shown only if this viewer may tick EVERY part.
                    const canAll = g.every(({ s: x }) =>
                      x.kind === "manual" && !x.settleKey
                        ? x.manualId != null && canActOnStep({ kind: "manual", fromId: x.fromId, toId: x.toId }, actor) && canActInMonth(open, isHead)
                        : open && canActOnStep({ kind: x.settleKey ? "transfer-out" : x.kind, fromId: x.fromId, toId: x.toId }, x.settleKey ? { ...actor, canEdit: false } : actor) && (!x.done || x.recordId != null));
                    if (!canAll) return null;
                    const payload = g.map(({ s: x }) => x.kind === "manual" && x.settleKey ? { t: "transfer", from: x.fromId, to: x.toId, amount: x.amount, key: x.settleKey, recordId: null } : x.kind === "manual" ? { t: "manual", id: x.manualId } : { t: "transfer", from: x.fromId, to: x.toId, amount: x.amount, key: x.id, recordId: x.recordId ?? null });
                    return (
                      <form action={withToast(async (fd: FormData) => { const r = await toggleStepGroup(fd); if (!r.ok) throw new Error(r.error); }, { success: s.done ? "Undone" : "Marked sent" })} onSubmit={confirmFront}>
                        <input type="hidden" name="householdId" value={householdId} />
                        <input type="hidden" name="periodId" value={periodId} />
                        <input type="hidden" name="items" value={JSON.stringify(payload)} />
                        {s.done && <input type="hidden" name="undo" value="1" />}
                        <MiniBtn primary={!s.done}>Sent</MiniBtn>
                      </form>
                    );
                  })() : isHandover || isPoolHandover ? null /* rendered inline in the content column above */ : isPiggy ? (
                    <span className="text-[9px] text-slate-300">est.</span>
                  ) : isAdvance ? (
                    s.advanceId != null && canActTransfer ? (
                      <form action={withToast(s.done ? unsettleAdvance : markAdvanceSettled, { success: "Updated" })} onSubmit={confirmFront}>
                        <input type="hidden" name="id" value={s.advanceId} />
                        {s.payback && <input type="hidden" name="leg" value="payback" />}
                        <MiniBtn primary={!s.done}>Sent</MiniBtn>
                      </form>
                    ) : null
                  ) : isAllowance ? (
                    s.billId != null && canActAllowance ? (
                      <form action={withToast(toggleBillPaid, { success: "Updated" })} onSubmit={confirmFront}><input type="hidden" name="id" value={s.billId} /><MiniBtn primary={!s.done}>Sent</MiniBtn></form>
                    ) : null
                  ) : isTransfer ? (
                    s.done ? (
                      canActTransfer && s.recordId != null ? (
                        <form action={withToast(unsettle, { success: "Updated" })}><input type="hidden" name="id" value={s.recordId} /><MiniBtn /></form>
                      ) : null
                    ) : canActTransfer ? (
                      <form action={withToast(markSettled, { success: "Marked done" })} onSubmit={confirmFront}>
                        <input type="hidden" name="householdId" value={householdId} />
                        <input type="hidden" name="periodId" value={periodId} />
                        <input type="hidden" name="fromMemberId" value={s.fromId} />
                        <input type="hidden" name="toMemberId" value={s.toId} />
                        <input type="hidden" name="amount" value={s.amount} />
                        <input type="hidden" name="key" value={s.id} />
                        <MiniBtn primary>Sent</MiniBtn>
                      </form>
                    ) : null
                  ) : isManual && s.settleKey ? (
                    // A pool-cash bridge leg: ticking it records a real direct payment (lender → payer) that
                    // counts toward what the lender owes the pool AND what the pool owes the payer.
                    open && canActOnStep({ kind: "transfer-out", fromId: s.fromId, toId: s.toId }, { ...actor, canEdit: false }) ? (
                      <form action={withToast(markSettled, { success: "Marked done" })} onSubmit={confirmFront}>
                        <input type="hidden" name="householdId" value={householdId} />
                        <input type="hidden" name="periodId" value={periodId} />
                        <input type="hidden" name="fromMemberId" value={s.fromId} />
                        <input type="hidden" name="toMemberId" value={s.toId} />
                        <input type="hidden" name="amount" value={s.amount} />
                        <input type="hidden" name="key" value={s.settleKey} />
                        <MiniBtn primary>Sent</MiniBtn>
                      </form>
                    ) : null
                  ) : isManual ? (
                    s.manualId != null && canActManual ? (
                      <form action={withToast(toggleManualStepDone, { success: "Updated" })} onSubmit={confirmClosed}><input type="hidden" name="id" value={s.manualId} /><MiniBtn primary={!s.done}>Sent</MiniBtn></form>
                    ) : null
                  ) : isIncome ? (
                    s.incomeId != null && canActIncome ? (
                      <form action={withToast(toggleIncomeReceived, { success: "Updated" })}><input type="hidden" name="id" value={s.incomeId} /><MiniBtn primary={!s.done}>Received</MiniBtn></form>
                    ) : null
                  ) : s.miscCard ? (
                    // Planned-misc spend card: pay it by logging a spend against its category (done once ≥1 exists).
                    s.done ? (
                      <span className="text-[10px] font-medium text-emerald-600">✓ logged</span>
                    ) : !canActBill ? (
                      <span className="text-[9px] text-slate-300">to be paid</span>
                    ) : (
                      <AddSpendModal trigger="card" triggerLabel="Pay" periodId={periodId} fixedCategory={{ id: s.categoryId!, name: s.vendor!, misc: false }} isHead={isHead} members={members} currentMemberId={currentMemberId} />
                    )
                  ) : s.cardBill ? (
                    // Family credit-card bill — paid from cash the owner already holds. OWNER-ONLY: only
                    // the card's owner (payerId) may pay/undo, not the head. Others see a muted placeholder.
                    currentMemberId === s.payerId && canEdit ? (
                      s.done ? (
                        <form action={withToast(unpayFamilyCardBill, { success: "Updated" })}>
                          <input type="hidden" name="cardId" value={s.cardId} />
                          <input type="hidden" name="cycleEnd" value={s.cycleEndISO} />
                          <MiniBtn />
                        </form>
                      ) : (
                        <PayCardBillModal
                          cardId={s.cardId!}
                          cardName={(s.vendor ?? "").replace(/ bill$/, "")}
                          color={s.cardColor ?? "#a21caf"}
                          cycleEndISO={s.cycleEndISO!}
                          dueISO={s.dueISO!}
                          familyBudgeted={s.cardFamilyBudgeted ?? s.amount}
                          familyBudgetedByMonth={s.cardFamilyBudgetedByMonth}
                          familyMisc={s.cardFamilyMisc ?? 0}
                          personalAmount={s.cardPersonal ?? 0}
                          annualFee={s.cardAnnualFee ?? 0}
                          categories={spendCategories}
                        />
                      )
                    ) : s.done ? (
                      <span className="text-[10px] font-medium text-emerald-600">✓ paid</span>
                    ) : (
                      <span className="text-[9px] text-slate-300">to be paid</span>
                    )
                  ) : (s.fund || s.billId != null) ? (
                    // Bill steps only become payable once the month is OPEN and you're the head or the
                    // bill's own payer. Before the month starts (preview draft) or for someone else's
                    // bill, show a muted "to be paid" placeholder instead of an active control.
                    !canActBill ? (
                      s.done ? null : <span className="text-[9px] text-slate-300">to be paid</span>
                    ) : s.fund && !s.done ? (
                      <PayBillModal categoryId={s.categoryId!} periodId={periodId} name={s.vendor!} bill={s.amount} fund={s.fundAvail ?? 0} saved={s.fundSaved} setAside={s.fundSetAside} generalPiggy={generalPiggy} cards={s.payerId != null ? cardsByMember[s.payerId] ?? [] : []} />
                    ) : s.misc && s.billId != null ? (
                      // Planned misc = estimate → actual-amount + Piggy-reconcile popup (undo reverses it).
                      s.done ? (
                        <form action={withToast(unpayMiscBill, { success: "Updated" })}><input type="hidden" name="id" value={s.billId} /><MiniBtn /></form>
                      ) : (
                        <MiscPayModal id={s.billId} name={s.vendor!} estimate={s.amount} generalPiggy={generalPiggy} />
                      )
                    ) : s.billId != null ? (
                      <form action={withToast(toggleBillPaid, { success: "Updated" })} onSubmit={confirmFront}>
                        <input type="hidden" name="id" value={s.billId} />
                        {s.poolVendorLeg && <input type="hidden" name="leg" value="vendor" />}
                        <MiniBtn primary={!s.done}>Pay</MiniBtn>
                      </form>
                    ) : null
                  ) : null}
                </span>
                </div>

                {/* head reorder: move this step one slot up/down (positional), then the plan recomputes. */}
                {isHead && datesEditable && who == null && (
                  <span className="flex shrink-0 flex-col justify-center leading-none">
                    <button
                      type="button"
                      title={g ? "Move this grouped transfer up" : "Move up a step"}
                      disabled={pending}
                      onClick={() => move(items.map((x) => x.s.id), "up", i > 0 ? displayRows[i - 1].items.map((x) => x.s.id) : [])}
                      className="px-0.5 text-[10px] text-slate-300 hover:text-slate-600 disabled:opacity-30"
                    >▲</button>
                    <button
                      type="button"
                      title={g ? "Move this grouped transfer down" : "Move down a step"}
                      disabled={pending}
                      onClick={() => move(items.map((x) => x.s.id), "down", i < displayRows.length - 1 ? displayRows[i + 1].items.map((x) => x.s.id) : [])}
                      className="px-0.5 text-[10px] text-slate-300 hover:text-slate-600 disabled:opacity-30"
                    >▼</button>
                  </span>
                )}
                {/* delete: manual steps are removed outright; derived steps are hidden from the plan view */}
                {canEdit && open && who == null && !g && (
                  isManual && isRefundGroup(s.bridgeGroup) ? null : isManual ? (
                    <form action={withToast(deleteManualStep, { success: "Step deleted" })} className="shrink-0"><input type="hidden" name="id" value={s.manualId} /><button title="Delete this step" className="px-0.5 text-sm text-slate-300 hover:text-red-600">✕</button></form>
                  ) : (
                    <form action={withToast(hideStep, { success: "Removed from plan" })} className="shrink-0"><input type="hidden" name="periodId" value={periodId} /><input type="hidden" name="stepKey" value={s.id} /><button title="Remove from plan (keeps the underlying bill/income)" className="px-0.5 text-sm text-slate-300 hover:text-red-600">✕</button></form>
                  )
                )}
              </li>
              )}
              {!dayCollapsed && canEdit && open && who == null && <InsertHere onClick={() => setInsert({ anchor: items[items.length - 1].s.id })} />}
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
                  <span className="min-w-0 truncate line-through">{stepTitle(s)}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums">{formatINR(s.amount)}</span>
                    {canEdit && open && (
                      <form action={withToast(unhideStep, { success: "Restored to plan" })}><input type="hidden" name="periodId" value={periodId} /><input type="hidden" name="stepKey" value={s.id} /><button className="font-medium text-emerald-600 hover:underline">un-hide</button></form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        </>
      )}

      {/* Bridge a short bill from anyone holding cash (hub included): the plan works out how they're paid
          back and shows it per member before confirming — see LendModal / previewLend. */}
      {bridge && (
        <LendModal
          periodId={periodId}
          billId={bridge.billId!}
          label={bridge.vendor ?? "this bill"}
          payerName={bridge.payerName ?? "The payer"}
          shortfall={Math.round((bridge.senderShort ?? 0) * 100) / 100}
          day={bridge.day ?? null}
          onClose={() => setBridge(null)}
        />
      )}

      {/* Add-a-step modal: a real member↔member (or ↔ hub) move, inserted at the chosen spot. */}
      {insert && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setInsert(null)}>
          <div className="w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Add a step</h3>
            <form action={withToast(addManualStep, { success: "Step added" })} onSubmit={() => setInsert(null)} className="space-y-2.5">
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
              <label className="block text-[11px] font-medium text-slate-500">Note
                <input name="note" type="text" maxLength={140} placeholder="why this move — e.g. advance for school fees" className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
              </label>
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
            {/* Fund bill: explain WHY every cash row below is unchanged — it's drawn from the saved-up
                fund, not anyone's cash — and warn when the fund can't cover the whole bill. */}
            {balances.s.kind === "bill" && balances.s.fund && (() => {
              const avail = balances.s.fundAvail ?? 0;
              const amount = balances.s.amount;
              const shortBy = Math.round((amount - avail) * 100) / 100;
              const after = Math.max(0, Math.round((avail - amount) * 100) / 100);
              return (
                <div className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-[11px] leading-relaxed text-indigo-800">
                  🏦 Paid from the <b>{balances.s.vendor}</b> fund — money already set aside, so no one&apos;s cash-in-hand below moves.
                  {shortBy > 0.005 ? (
                    <span className="mt-1 block font-medium text-amber-700">Fund covers {formatINR(avail)} of {formatINR(amount)}; {balances.s.payerName} tops up the remaining {formatINR(shortBy)} from the Piggy or their pocket.</span>
                  ) : (
                    <span className="mt-1 block text-indigo-600">Fund {formatINR(avail)} → {formatINR(after)} after this bill.</span>
                  )}
                </div>
              );
            })()}
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
  if (s.kind === "allowance") return `${s.fromName} → ${s.toName}`;
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
function DateGroupHeader({ day, kind, collapsed, count, done, onToggle }: { day: number | null; kind: MoneyPlanResult["steps"][number]["kind"]; collapsed?: boolean; count?: number; done?: number; onToggle?: () => void }) {
  const label =
    day != null ? `📅 ${ordinal(day)}` : kind === "income" || kind === "transfer-in" ? "⬆︎ Up front" : "🗓 No set date";
  // Each day folds into a single tappable header — tap to expand/collapse its steps. The chip reads
  // "✓ N done" when the whole day is settled, else "N pending" (how many steps are still to do).
  if (onToggle) {
    const total = count ?? 0;
    const pending = total - (done ?? 0);
    const allDone = total > 0 && pending <= 0;
    return (
      <li className="list-none pt-2.5 first:pt-0">
        <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 rounded-md py-0.5 text-left hover:bg-slate-50">
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${allDone ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
            {allDone ? `✓ ${total} done` : `${pending} pending`}
          </span>
          <span className="h-px flex-1 bg-slate-200" />
          <svg width="12" height="12" viewBox="0 0 20 20" className={`shrink-0 text-slate-400 transition-transform ${collapsed ? "" : "rotate-90"}`} aria-hidden>
            <path fill="currentColor" d="M7 5l6 5-6 5z" />
          </svg>
        </button>
      </li>
    );
  }
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

// Submit button in the shared action style (see Cta): primary = one-tap "✓ <label>", else "Undo".
function MiniBtn({ children, primary }: { children?: React.ReactNode; primary?: boolean }) {
  return (
    <button type="submit" className={CTA_CLASS[primary ? "tap" : "undo"]}>
      <CtaLabel kind={primary ? "tap" : "undo"}>{primary ? children : "Undo"}</CtaLabel>
    </button>
  );
}

function ordinal(day: number) {
  return `${day}${["th", "st", "nd", "rd"][((day % 100) - 20) % 10] ?? ["th", "st", "nd", "rd"][day % 100] ?? "th"}`;
}

// Urgency colours (red = overdue / due today, amber = due in 1–2 days) are ONLY for steps still to do.
// A done step is history: a quiet grey "was due <day>" (or "on <day>" for income), never red/amber.
// One urgency rule for every step: the server's status when it set one (bills use their real due date),
// otherwise derived from the step's day vs today — only while viewing the current month (currentDay set).
// Income is an arrival, never urgent. Overdue = day passed; soon = today or within 2 days.
type Urgency = { status: "overdue" | "soon" | "normal" | null; days: number | null };
function urgencyOf(s: { kind: string; day: number | null; status?: Urgency["status"]; days?: number | null }, currentDay: number | null): Urgency {
  if (s.status != null || s.kind === "income") return { status: s.status ?? null, days: s.days ?? null };
  if (currentDay == null || s.day == null) return { status: null, days: null };
  const days = s.day - currentDay;
  return { status: days < 0 ? "overdue" : days <= 2 ? "soon" : "normal", days };
}

function DayTag({ kind, day, status, days, done = false }: { kind: string; day: number | null; status: "overdue" | "soon" | "normal" | null; days: number | null; done?: boolean }) {
  const ord = day == null ? null : ordinal(day);
  if (done) return ord ? <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-400">{kind === "income" ? `on ${ord}` : `was due ${ord}`}</span> : null;
  // Income lands ON a day (or "up front" if undated) — it's an arrival, not a deadline.
  if (kind === "income") return <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600">{ord ? `on ${ord}` : "up front"}</span>;
  // Disbursements (hub → member) go out once the hub has collected enough. They're scheduled to a
  // real target day (reimburse-day, or the day a funded bill falls due) — show it as "by <day>", and
  // only fall back to "after collection" when there's genuinely no date (the month-end residual).
  // They still turn red/amber like any other step once their day is today or past (handled below).
  if ((kind === "transfer-out" || kind === "allowance") && (day == null || (status !== "overdue" && status !== "soon"))) return <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">{ord ? `by ${ord}` : "after collection"}</span>;
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
