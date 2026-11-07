"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useSavingToast } from "@/components/useSavingToast";
import {
  tickPlanStep, untickPlanStep, redatePlanStep, setPlanStepSkipped, deletePlanStep, movePlanStep,
  addPlanStep, editPlanStep, setPlanStepRoute, payCardBillStep,
  tickPlanStepGroup, untickPlanStepGroup, movePlanStepGroup, rebuildPlanSteps,
  type PersonalSaveState,
} from "@/app/personal/actions";
import { useToast } from "@/components/Toast";
import { ToastForm } from "@/components/ToastForm";
import { formatINR } from "@/lib/format";

// A credit-card bill step's statement breakdown — the same figures the family In-Hand ("held for this card")
// and the card page show, so the three always agree.
export type CardBillView = {
  cardName: string; color: string; dueISO: string | null;
  personal: number; annualFee: number; family: number; familyBudgeted: number; familyMisc: number;
};
export type PlanStepView = {
  id: number; kind: string; label: string; amount: number; dayOfMonth: number | null;
  status: string; templateKind: string | null; method: string | null; note: string | null;
  fromId: number | null; toId: number | null; fromName: string | null; toName: string | null;
  oneOff: boolean; card: CardBillView | null;
};
type Acct = { id: number; name: string; type: string; familyPrimary?: boolean; personalPrimary?: boolean };
type Cat = { id: number; name: string; icon: string | null };

const METHODS = [
  { key: "upi", label: "UPI / bank", icon: "📲", types: ["bank", "debit_card", "prepaid_card"] },
  { key: "cash", label: "Cash", icon: "💵", types: ["cash"] },
  { key: "card", label: "Card", icon: "💳", types: ["credit_card", "debit_card", "prepaid_card"] },
  { key: "other", label: "Other", icon: "•••", types: [] as string[] }, // [] = every account
] as const;
const methodLabel = (m: string | null) => METHODS.find((x) => x.key === m)?.label ?? null;
const BALANCE_TYPES = new Set(["bank", "cash", "debit_card", "prepaid_card"]);
const KIND_ICON: Record<string, string> = { income: "💰", transfer: "🔁", save: "🐷", expense: "🧾", spend: "🛒", cardbill: "💳" };
const KIND_NAME: Record<string, string> = { income: "Income", transfer: "Transfer", save: "Save", expense: "Bill", spend: "Spend" };

// Accounts a picker should offer for a method. Receivers can never be a credit card.
function offered(accounts: Acct[], method: string | null, receiver: boolean): Acct[] {
  const m = METHODS.find((x) => x.key === method);
  const byMethod = !m || m.types.length === 0 ? accounts : accounts.filter((a) => (m.types as readonly string[]).includes(a.type));
  return receiver ? byMethod.filter((a) => BALANCE_TYPES.has(a.type)) : byMethod;
}

function flow(s: PlanStepView): string {
  if (s.kind === "cardbill") return s.card ? `${s.card.dueISO ? `due ${new Date(s.card.dueISO).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : "due date not set"} · you ${formatINR(s.card.personal + s.card.annualFee)} + family ${formatINR(s.card.family)}` : s.note ?? "";
  const via = methodLabel(s.method);
  const pre = via ? `${via} · ` : "";
  if (s.kind === "income") return `${pre}${s.toName ? `received → ${s.toName}` : "received · pick an account"}`;
  if (s.kind === "transfer") return `${pre}${s.fromName ?? "?"} → ${s.toName ?? "?"}`;
  if (s.kind === "save") return `${pre}${s.fromName ? `${s.fromName} ` : ""}→ savings pot`;
  if (s.kind === "expense" || s.kind === "spend") return `${pre}${s.fromName ? `from ${s.fromName}` : via ? "" : "pick how you pay"}`.replace(/ · $/, "");
  return "";
}

// Does ticking this step need the member to say which account first? (Asked in the mark-paid modal, never guessed.)
function needsAccount(s: PlanStepView): boolean {
  if (s.kind === "transfer") return s.fromId == null || s.toId == null;
  if (s.kind === "expense" || s.kind === "spend") return s.fromId == null && s.method !== "cash";
  if (s.kind === "income") return s.toId == null && s.method == null;
  return false;
}

function Overlay({ onClose, title, children, hidden = false }: { onClose: () => void; title: string; children: ReactNode; hidden?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={`fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4${hidden ? " hidden" : ""}`} onClick={onClose}>
      <div className="flex w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Method chips + sender/receiver selects, shared by the inline route editor and the mark-paid prompt.
function RouteFields({ s, accounts, method, setMethod, requireAll }: { s: PlanStepView; accounts: Acct[]; method: string | null; setMethod: (m: string | null) => void; requireAll?: boolean }) {
  const hasFrom = s.kind !== "income";
  const hasTo = s.kind === "income" || s.kind === "transfer";
  const fromOpts = offered(accounts, method, false);
  const toOpts = offered(accounts, method, true);
  const fromLabel = s.kind === "transfer" ? "Sender account" : s.kind === "save" ? "Paid from (optional)" : "Paid from";
  const fromRequired = !!requireAll && s.kind === "transfer";
  return (
    <>
      <input type="hidden" name="method" value={method ?? ""} />
      <div className="grid grid-cols-4 gap-1.5">
        {METHODS.map((m) => (
          <button key={m.key} type="button" onClick={() => setMethod(method === m.key ? null : m.key)}
            className={`rounded-lg border px-1 py-1.5 text-[11px] font-medium ${method === m.key ? "border-emerald-500 bg-white text-emerald-700" : "border-slate-200 bg-white text-slate-500"}`}>
            <span className="block">{m.icon}</span>{m.label}
          </button>
        ))}
      </div>
      <div className={`grid gap-2 ${hasFrom && hasTo ? "sm:grid-cols-2" : ""}`}>
        {hasFrom && (
          <label className="block text-[11px] font-medium text-slate-500">{fromLabel}
            <select key={`f${method}`} name="fromAccountId" required={fromRequired} defaultValue={fromOpts.some((a) => a.id === s.fromId) ? s.fromId ?? "" : ""} className="input mt-1 w-full">
              <option value="">{method === "cash" ? "Cash (no account)" : fromRequired ? "Pick an account" : "— no account —"}</option>
              {fromOpts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        {hasTo && (
          <label className="block text-[11px] font-medium text-slate-500">{s.kind === "income" ? "Received into" : "Receiver account"}
            <select key={`t${method}`} name="toAccountId" required={!!requireAll && s.kind === "transfer"} defaultValue={toOpts.some((a) => a.id === s.toId) ? s.toId ?? "" : ""} className="input mt-1 w-full">
              <option value="">{s.kind === "income" ? "— budget only —" : "Pick an account"}</option>
              {toOpts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
      </div>
    </>
  );
}

// The month's executable choreography: one ordered checklist copied from Setup each month. Per month you can
// tick (pay) each step, edit it, move it up/down, insert a step between, or remove it — Setup stays untouched.
export type SetupCounts = { incomes: number; moves: number; bills: number; spends: number; removed: number };

export function PersonalPlanSteps({ steps, accounts, categories, periodId, setup, currentDay }: { steps: PlanStepView[]; accounts: Acct[]; categories: Cat[]; periodId: number; setup: SetupCounts; currentDay: number | null }) {
  const [adding, setAdding] = useState<{ after: number | "top" } | null>(null);
  const active = steps.filter((s) => s.status !== "skipped");
  const removed = steps.filter((s) => s.status === "skipped");
  const doneCount = active.filter((s) => s.status === "done").length;
  const items = clumpSteps(active);
  const [toggledDays, setToggledDays] = useState<Set<string>>(new Set());
  const dayGroups = groupByDay(items);
  const toggleDay = (k: string) => setToggledDays((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">This month&apos;s plan</h2>
          <p className="text-[11px] text-slate-400">Copied from Setup every month: income, bills, transfers, savings and card bills. (Recurring spends are in the Spends tab.) Mark each paid as it happens — it moves the real money.</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {active.length > 0 && <span className="text-[11px] font-medium text-slate-400">{doneCount}/{active.length} done</span>}
          <ToastForm action={rebuildPlanSteps} successMessage="Plan refreshed">
            <input type="hidden" name="periodId" value={periodId} />
            <button type="submit" title="Re-check the steps against this month's own lines (Sheet / Spends). Setup changes reach a month only via Setup's “Apply to this month”." className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50">↻ Refresh</button>
          </ToastForm>
        </div>
      </div>

      {steps.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">
          <p>No steps this month.</p>
          <p className="mt-1 text-xs">
            This month has <b>{setup.incomes}</b> recurring income{setup.incomes === 1 ? "" : "s"} and <b>{setup.bills}</b> bill{setup.bills === 1 ? "" : "s"} waiting to be paid; Setup has <b>{setup.moves}</b> transfer/saving{setup.moves === 1 ? "" : "s"}.
          </p>
          <p className="mt-1 text-xs">
            New months get their steps from <a className="font-medium text-emerald-700 underline" href="/personal/setup">Setup</a> automatically. To bring a Setup item into this month, use its <b>Apply to this month</b> there — or add a step below.
          </p>
        </div>
      ) : (
        <ol className="mt-2">
          <li className="list-none"><InsertGap onClick={() => setAdding({ after: "top" })} /></li>
          {dayGroups.map((g) => {
            // Like the family plan: a date heading per day with "N pending" / "✓ N done". A day that is fully
            // done folds away (tap to reopen); today and any day with something still to do stay open.
            const lines = g.items.flatMap((it) => (it.type === "step" ? [it.s] : it.steps));
            const doneN = lines.filter((l) => l.status === "done").length;
            const pendingN = lines.length - doneN;
            const allDone = lines.length > 0 && pendingN <= 0;
            const defaultCollapsed = allDone && g.day !== currentDay;
            const collapsed = defaultCollapsed !== toggledDays.has(g.key);
            return (
              <li key={g.key} className="list-none pt-2 first:pt-0">
                <button type="button" onClick={() => toggleDay(g.key)} aria-expanded={!collapsed} className="flex w-full items-center gap-2 rounded-md py-0.5 text-left hover:bg-slate-50">
                  <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-slate-500">{g.label}</span>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${allDone ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>{allDone ? `✓ ${lines.length} done` : `${pendingN} pending`}</span>
                  <span className="h-px flex-1 bg-slate-200" />
                  <svg width="12" height="12" viewBox="0 0 20 20" className={`shrink-0 text-slate-400 transition-transform ${collapsed ? "" : "rotate-90"}`} aria-hidden><path fill="currentColor" d="M7 5l6 5-6 5z" /></svg>
                </button>
                {!collapsed && (
                  <ul className="mt-1">
                    {g.items.map((it) => {
                      const flat = items.indexOf(it);
                      return (
                        <li key={it.type === "step" ? it.s.id : it.key}>
                          {it.type === "step"
                            ? <StepRow s={it.s} accounts={accounts} isFirst={flat === 0} isLast={flat === items.length - 1} />
                            : <ClumpRow steps={it.steps} accounts={accounts} isFirst={flat === 0} isLast={flat === items.length - 1} />}
                          <InsertGap onClick={() => setAdding({ after: it.type === "step" ? it.s.id : it.steps[it.steps.length - 1].id })} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {removed.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-slate-400">{removed.length} removed this month — restore</summary>
          <ul className="mt-1.5 space-y-1.5">{removed.map((s) => <li key={s.id}><StepRow s={s} accounts={accounts} isFirst isLast /></li>)}</ul>
        </details>
      )}

      <button
        type="button"
        onClick={() => setAdding({ after: active.length ? active[active.length - 1].id : "top" })}
        className="mt-2 w-full rounded-lg border border-dashed border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
      >
        + Add step
      </button>
      {adding && <AddStepModal periodId={periodId} accounts={accounts} categories={categories} after={adding.after} onClose={() => setAdding(null)} />}
    </section>
  );
}

const ordinal = (d: number) => `${d}${["th", "st", "nd", "rd"][((d % 100) - 20) % 10] ?? ["th", "st", "nd", "rd"][d % 100] ?? "th"}`;
type DayGroup = { key: string; day: number | null; label: string; items: PlanItem[] };
// Consecutive items on the same date share one heading (so a manual re-order that breaks date order simply
// repeats a heading rather than hiding anything). Undated income reads "Up front", other undated "No set date".
function groupByDay(items: PlanItem[]): DayGroup[] {
  const out: DayGroup[] = [];
  for (const it of items) {
    const first = it.type === "step" ? it.s : it.steps[0];
    const day = first.dayOfMonth;
    const label = day != null ? `📅 ${ordinal(day)}` : first.kind === "income" ? "⬆︎ Up front" : "🗓 No set date";
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(it);
    else out.push({ key: `${label}#${out.length}`, day, label, items: [it] });
  }
  return out;
}

type PlanItem = { type: "step"; s: PlanStepView } | { type: "clump"; key: string; steps: PlanStepView[] };

// Same-route steps collapse into ONE clump (shown as a single step with its lines inside), sitting where its
// first line sat: transfers with the same sender → receiver, and bills paid from the same account (or all with
// no account yet), each on the same day and in the same state.
function clumpSteps(active: PlanStepView[]): PlanItem[] {
  const keyOf = (s: PlanStepView) =>
    s.kind === "transfer" && s.fromId != null && s.toId != null ? `t|${s.fromId}|${s.toId}|${s.dayOfMonth ?? "x"}|${s.status}`
    : s.kind === "expense" && (s.status === "pending" || s.status === "done") ? `b|${s.fromId ?? "none"}|${s.dayOfMonth ?? "x"}|${s.status}`
    : null;
  const groups = new Map<string, PlanStepView[]>();
  for (const s of active) { const k = keyOf(s); if (k) groups.set(k, [...(groups.get(k) ?? []), s]); }
  const out: PlanItem[] = [];
  const emitted = new Set<string>();
  for (const s of active) {
    const k = keyOf(s);
    const g = k ? groups.get(k)! : null;
    if (k && g && g.length > 1) {
      if (emitted.has(k)) continue;
      emitted.add(k);
      out.push({ type: "clump", key: `clump:${k}`, steps: g });
    } else out.push({ type: "step", s });
  }
  return out;
}

// One step for several same-route lines: tick once and the real total moves; open it to see, edit or remove the
// individual lines (gold, APY, FD, rent…). A bills clump with no account yet asks which account paid it.
function ClumpRow({ steps, accounts, isFirst, isLast }: { steps: PlanStepView[]; accounts: Acct[]; isFirst: boolean; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const first = steps[0];
  const done = first.status === "done";
  const isBills = first.kind === "expense";
  const total = Math.round(steps.reduce((t, s) => t + s.amount, 0) * 100) / 100;
  const ids = steps.map((s) => s.id).join(",");
  const needsAcct = isBills && !done && first.fromId == null;
  const title = isBills ? `Bills · ${first.fromName ? `from ${first.fromName}` : "no account yet"}` : `${first.fromName ?? "?"} → ${first.toName ?? "?"}`;
  const tickCls = `flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs transition-colors ${done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent hover:border-emerald-400"}`;
  return (
    <div className="space-y-1.5">
      <div className={`flex items-center gap-2.5 rounded-lg border p-2.5 ${done ? "border-emerald-100 bg-emerald-50/60" : "border-slate-100"}`}>
        {needsAcct ? (
          <button type="button" onClick={() => setAsking(true)} aria-label="Mark all paid" title={`Pay ${formatINR(total)} — asks which account`} className={tickCls}>✓</button>
        ) : (
          <form action={done ? untickPlanStepGroup : tickPlanStepGroup}>
            <input type="hidden" name="ids" value={ids} />
            <button type="submit" aria-label={done ? "Mark all not done" : "Mark all done"} title={done ? "Undo — reverses every line" : `Move ${formatINR(total)} — marks every line done`} className={tickCls}>✓</button>
          </form>
        )}
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <span className="flex items-center gap-1.5">
            <span className="shrink-0">{isBills ? "🧾" : "🔁"}</span>
            <span className={`truncate text-sm font-medium ${done ? "text-slate-500" : "text-slate-800"}`}>{title}</span>
            <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[9px] font-medium text-slate-500">{steps.length} items</span>
          </span>
          <span className="block truncate text-[11px] text-slate-400">{steps.map((s) => `${s.label} ${formatINR(s.amount)}`).join(" · ")} <span className="text-slate-300">{open ? "▴" : "▾"}</span></span>
        </button>
        <span className="shrink-0 text-right">
          <span className="block tabular-nums text-sm font-semibold text-slate-800">{formatINR(total)}</span>
          {first.dayOfMonth != null && <span className="block text-[11px] text-slate-400">day {first.dayOfMonth}</span>}
        </span>
        <span className="flex shrink-0 items-center text-[11px]">
          <form action={movePlanStepGroup}><input type="hidden" name="ids" value={ids} /><input type="hidden" name="dir" value="up" />
            <button type="submit" disabled={isFirst} aria-label="Move up" className="px-1 text-slate-400 hover:text-slate-800 disabled:opacity-25">↑</button></form>
          <form action={movePlanStepGroup}><input type="hidden" name="ids" value={ids} /><input type="hidden" name="dir" value="down" />
            <button type="submit" disabled={isLast} aria-label="Move down" className="px-1 text-slate-400 hover:text-slate-800 disabled:opacity-25">↓</button></form>
        </span>
      </div>
      {open && (
        <ul className="ml-4 space-y-1.5 border-l-2 border-slate-100 pl-2">
          {steps.map((s) => <li key={s.id}><StepRow s={s} accounts={accounts} isFirst isLast /></li>)}
        </ul>
      )}
      {asking && (
        <Overlay onClose={() => setAsking(false)} title={`Paid: ${steps.length} bills`}>
          <form action={tickPlanStepGroup} onSubmit={() => setTimeout(() => setAsking(false), 0)} className="space-y-4 px-5 py-4">
            <input type="hidden" name="ids" value={ids} />
            <input type="hidden" name="method" value="other" />
            <p className="text-sm text-slate-500">{formatINR(total)} across {steps.length} bills — which account did you pay from? Each bill is debited from it.</p>
            <select name="fromAccountId" defaultValue="" className="input w-full">
              <option value="">No account (just mark paid)</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button type="button" onClick={() => setAsking(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600">Cancel</button>
              <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Mark paid</button>
            </div>
          </form>
        </Overlay>
      )}
    </div>
  );
}

// A thin "insert a step here" target between rows — create a step in between two others.
function InsertGap({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Insert a step here" title="Insert a step here"
      className="group flex h-3 w-full items-center justify-center">
      <span className="h-px flex-1 bg-transparent group-hover:bg-emerald-200" />
      <span className="mx-1 rounded-full px-1.5 text-[10px] leading-none text-transparent group-hover:bg-emerald-50 group-hover:text-emerald-600 group-focus-visible:text-emerald-600">＋ insert</span>
      <span className="h-px flex-1 bg-transparent group-hover:bg-emerald-200" />
    </button>
  );
}

function StepRow({ s, accounts, isFirst, isLast }: { s: PlanStepView; accounts: Acct[]; isFirst: boolean; isLast: boolean }) {
  const [panel, setPanel] = useState<null | "route" | "edit" | "pay" | "prompt">(null);
  const done = s.status === "done";
  const skipped = s.status === "skipped";
  const isCard = s.kind === "cardbill";
  const incomplete = s.kind === "transfer" && (s.fromId == null || s.toId == null);
  const canEdit = !done && !skipped;

  const tickButton = (
    <button
      type="button"
      onClick={() => setPanel(isCard ? "pay" : "prompt")}
      aria-label="Mark paid"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs text-transparent transition-colors hover:border-emerald-400"
    >
      ✓
    </button>
  );

  return (
    <div className="space-y-2">
      <div className={`flex items-center gap-2.5 rounded-lg border p-2.5 ${done ? "border-emerald-100 bg-emerald-50/60" : skipped ? "border-slate-100 bg-slate-50 opacity-70" : "border-slate-100"}`}>
        {!skipped && (done ? (
          <form action={untickPlanStep}>
            <input type="hidden" name="id" value={s.id} />
            <button type="submit" aria-label="Mark not paid" title="Undo — reverses the money move" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-500 bg-emerald-500 text-xs text-white">✓</button>
          </form>
        ) : needsAccount(s) || isCard ? tickButton : (
          <form action={tickPlanStep}>
            <input type="hidden" name="id" value={s.id} />
            <button type="submit" aria-label="Mark paid" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs text-transparent transition-colors hover:border-emerald-400">✓</button>
          </form>
        ))}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="shrink-0">{KIND_ICON[s.kind] ?? "•"}</span>
            <span className={`truncate text-sm ${done ? "text-slate-500" : "text-slate-800"}`}>{s.label}</span>
            {s.oneOff && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[9px] font-medium text-slate-500">added</span>}
          </span>
          {canEdit && !isCard ? (
            <button type="button" onClick={() => setPanel(panel === "route" ? null : "route")} className={`block max-w-full truncate text-left text-[11px] underline decoration-dotted underline-offset-2 ${incomplete ? "text-amber-600" : "text-slate-400 hover:text-slate-700"}`}>
              {flow(s) || "set accounts"} ✎
            </button>
          ) : (
            <span className="block truncate text-[11px] text-slate-400">{flow(s)}{done && s.kind === "cardbill" && s.fromName ? ` · paid from ${s.fromName}` : ""}</span>
          )}
        </span>
        <span className="shrink-0 text-right">
          {canEdit ? (
            <button type="button" onClick={() => setPanel("edit")} title="Tap to edit this month's amount, name and day" className={`block w-full text-right tabular-nums text-sm font-semibold underline decoration-dotted underline-offset-2 ${s.kind === "income" ? "text-emerald-700" : "text-slate-800"}`}>{formatINR(s.amount)}</button>
          ) : (
            <span className={`block tabular-nums text-sm font-semibold ${s.kind === "income" ? "text-emerald-700" : "text-slate-800"}`}>{formatINR(s.amount)}</span>
          )}
          {canEdit ? <DayEdit id={s.id} day={s.dayOfMonth} /> : s.dayOfMonth != null && <span className="block text-[11px] text-slate-400">day {s.dayOfMonth}</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-[11px]">
          {!skipped && (
            <span className="flex items-center">
              <form action={movePlanStep}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="dir" value="up" />
                <button type="submit" disabled={isFirst} aria-label="Move up" className="px-1 text-slate-400 hover:text-slate-800 disabled:opacity-25">↑</button></form>
              <form action={movePlanStep}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="dir" value="down" />
                <button type="submit" disabled={isLast} aria-label="Move down" className="px-1 text-slate-400 hover:text-slate-800 disabled:opacity-25">↓</button></form>
            </span>
          )}
          <span className="flex items-center gap-1.5">
            {canEdit && <button type="button" onClick={() => setPanel("edit")} className="text-slate-400 hover:text-slate-700">edit</button>}
            {!done && (s.oneOff ? (
              <form action={deletePlanStep}><input type="hidden" name="id" value={s.id} />
                <button type="submit" aria-label="Delete" className="text-slate-300 hover:text-red-600">✕</button></form>
            ) : (
              <form action={setPlanStepSkipped}>
                <input type="hidden" name="id" value={s.id} /><input type="hidden" name="skip" value={skipped ? "0" : "1"} />
                <button type="submit" title={skipped ? "Bring it back this month" : "Remove from this month only — Setup keeps it"} className="text-slate-400 hover:text-slate-700">{skipped ? "↩ restore" : "remove"}</button>
              </form>
            ))}
          </span>
        </span>
      </div>
      {panel === "route" && canEdit && <RouteEditor s={s} accounts={accounts} onClose={() => setPanel(null)} />}
      {panel === "edit" && canEdit && <EditStepModal s={s} onClose={() => setPanel(null)} />}
      {panel === "prompt" && <MarkPaidPrompt s={s} accounts={accounts} onClose={() => setPanel(null)} />}
      {panel === "pay" && s.card && <CardBillPayModal s={s} card={s.card} accounts={accounts} onClose={() => setPanel(null)} />}
    </div>
  );
}

// Pick HOW the money moves (UPI / cash / card / other) and the sender + receiver accounts for one step.
function RouteEditor({ s, accounts, onClose }: { s: PlanStepView; accounts: Acct[]; onClose: () => void }) {
  const toast = useToast();
  const prevN = useRef(0);
  const [method, setMethod] = useState<string | null>(s.method);
  const [state, formAction, saving] = useActionState(setPlanStepRoute, { ok: false, n: 0 } as PersonalSaveState);
  useSavingToast(saving);
  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      if (state.ok) { toast("Accounts saved", "success"); onClose(); } else toast(state.error ?? "Couldn't save", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);
  return (
    <form action={formAction} className="space-y-2.5 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
      <input type="hidden" name="id" value={s.id} />
      <RouteFields s={s} accounts={accounts} method={method} setMethod={setMethod} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">Cancel</button>
        <button type="submit" className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Save</button>
      </div>
    </form>
  );
}

// Shown when a step is marked paid but has no account chosen yet — asks instead of guessing.
function MarkPaidPrompt({ s, accounts, onClose }: { s: PlanStepView; accounts: Acct[]; onClose: () => void }) {
  const [method, setMethod] = useState<string | null>(s.method);
  const verb = s.kind === "income" ? "received" : s.kind === "transfer" ? "done" : "paid";
  return (
    <Overlay onClose={onClose} title={`Mark ${verb}: ${s.label}`}>
      <form action={tickPlanStep} onSubmit={() => setTimeout(onClose, 0)} className="space-y-4 px-5 py-4">
        <input type="hidden" name="id" value={s.id} />
        <p className="text-sm text-slate-500">
          {formatINR(s.amount)} — {s.kind === "income" ? "which account did it land in?" : s.kind === "transfer" ? "which accounts did it move between?" : "which account did you pay from? Its balance drops by this amount."}
        </p>
        <RouteFields s={s} accounts={accounts} method={method} setMethod={setMethod} requireAll />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600">Cancel</button>
          <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Mark {verb}</button>
        </div>
      </form>
    </Overlay>
  );
}

// Edit a step's details for this month only (Setup is not changed).
function EditStepModal({ s, onClose }: { s: PlanStepView; onClose: () => void }) {
  const toast = useToast();
  const prevN = useRef(0);
  const [state, formAction, saving] = useActionState(editPlanStep, { ok: false, n: 0 } as PersonalSaveState);
  useSavingToast(saving);
  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      if (state.ok) { toast("Step updated for this month", "success"); onClose(); } else toast(state.error ?? "Couldn't save", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);
  const isCard = s.kind === "cardbill";
  return (
    <Overlay hidden={saving} onClose={onClose} title="Edit step">
      <form action={formAction} className="space-y-4 px-5 py-4">
        <input type="hidden" name="id" value={s.id} />
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">Changes apply to <b>this month only</b> — your Setup stays as it is.</p>
        <div>
          <label className="text-xs font-medium text-slate-500">Name</label>
          <input name="label" required defaultValue={s.label} readOnly={isCard} className="input mt-1 w-full" />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs font-medium text-slate-500">Amount (₹)</label>
            <input name="amount" type="number" step="0.01" inputMode="decimal" required={!isCard} readOnly={isCard} defaultValue={s.amount} className="input mt-1 w-full" />
            {isCard && <p className="mt-1 text-[10px] text-slate-400">Follows the card&apos;s statement; adjust the exact amount when you pay.</p>}
          </div>
          <div className="w-24">
            <label className="text-xs font-medium text-slate-500">Day</label>
            <input name="dayOfMonth" type="number" min={1} max={28} defaultValue={s.dayOfMonth ?? ""} placeholder="—" className="input mt-1 w-full" />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Note (optional)</label>
          <input name="note" defaultValue={s.note ?? ""} maxLength={120} className="input mt-1 w-full" />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600">Cancel</button>
          <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Save</button>
        </div>
      </form>
    </Overlay>
  );
}

function Row({ label, hint, value, strong, tone }: { label: string; hint?: string; value: number; strong?: boolean; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className={strong ? "font-semibold text-slate-800" : "text-slate-600"}>{label} {hint && <span className="text-[11px] text-slate-400">{hint}</span>}</span>
      <span className={`shrink-0 tabular-nums ${strong ? "font-semibold text-slate-800" : tone ?? "text-slate-600"}`}>{formatINR(value)}</span>
    </div>
  );
}

// Pay a credit-card bill: shows exactly how much is yours (leaves the personal account you pick) and how much
// is the family's (taken from the family In-Hand — the same figure as "held for this card" there).
function CardBillPayModal({ s, card, accounts, onClose }: { s: PlanStepView; card: CardBillView; accounts: Acct[]; onClose: () => void }) {
  const toast = useToast();
  const prevN = useRef(0);
  const swipes = Math.round((card.personal + card.family) * 100) / 100;
  const suggested = Math.round((swipes + card.annualFee) * 100) / 100;
  const [amount, setAmount] = useState(String(suggested));
  const bankAccts0 = accounts.filter((a) => BALANCE_TYPES.has(a.type));
  // Where each share's money sits today: the family share in your family account, yours in your personal
  // account (or your only account). The bill is paid in one go from whichever account you pick; a share
  // sitting elsewhere becomes a transfer step into that account.
  const personalDefault = String((bankAccts0.find((a) => a.personalPrimary) ?? (bankAccts0.length === 1 ? bankAccts0[0] : null))?.id ?? "");
  const familyDefault = String(bankAccts0.find((a) => a.familyPrimary)?.id ?? "");
  const [fromId, setFromId] = useState(personalDefault);
  const [familyFromId, setFamilyFromId] = useState(familyDefault);
  const [personalFromId, setPersonalFromId] = useState(personalDefault);
  const [movedNow, setMovedNow] = useState(false); // OFF by default: the transfer steps wait for a tick
  const [state, formAction, saving] = useActionState(payCardBillStep, { ok: false, n: 0 } as PersonalSaveState);
  useSavingToast(saving);
  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      if (state.ok) { toast("Card bill paid", "success"); onClose(); } else toast(state.error ?? "Couldn't pay", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);
  const amountNum = Number(amount) || 0;
  const diff = Math.round((amountNum - suggested) * 100) / 100;
  const fromYou = Math.max(0, Math.round((amountNum - card.family) * 100) / 100);
  const familyPart = Math.min(card.family, amountNum);
  const bankAccts = bankAccts0;
  const nameOf = (id: string) => bankAccts.find((a) => String(a.id) === id)?.name ?? "?";
  const moves = [
    familyPart > 0.005 && familyFromId && familyFromId !== fromId ? { from: familyFromId, amt: familyPart, what: "family share" } : null,
    fromYou > 0.005 && personalFromId && personalFromId !== fromId ? { from: personalFromId, amt: fromYou, what: "your share" } : null,
  ].filter((m): m is { from: string; amt: number; what: string } => m != null);
  const due = card.dueISO ? new Date(card.dueISO).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : null;
  return (
    <Overlay hidden={saving} onClose={onClose} title={`Pay ${card.cardName} bill`}>
      <form action={formAction} className="space-y-4 px-5 py-4">
        <input type="hidden" name="id" value={s.id} />
        <div className="space-y-1.5 rounded-xl p-3" style={{ backgroundColor: `${card.color}0d` }}>
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: card.color }}>Statement{due ? ` · due ${due}` : ""}</p>
          <div className="rounded-lg bg-white/70 p-2">
            <Row label="👪 Family spends" hint="taken from family In-Hand" value={card.family} strong />
            {card.family > 0.005 && (
              <div className="ml-4 mt-0.5 space-y-0.5 text-xs">
                {card.familyBudgeted > 0.005 && <Row label="⛽ budgeted" hint="from the held budget" value={card.familyBudgeted} />}
                {card.familyMisc > 0.005 && <Row label="🛒 misc / other" hint="from your in-hand" value={card.familyMisc} />}
              </div>
            )}
          </div>
          <div className="rounded-lg bg-white/70 p-2">
            <Row label="👤 Your spends" hint="from your account" value={card.personal} strong />
            {card.annualFee > 0.005 && <div className="ml-4 mt-0.5 text-xs"><Row label="🧾 Annual fee" value={card.annualFee} /></div>}
          </div>
          <div className="border-t border-slate-200 pt-1.5"><Row label="Statement total" value={suggested} strong /></div>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-600">Amount you paid (₹)</label>
          <input name="amount" type="number" step="0.01" min="0" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} style={{ borderColor: card.color }} className="mt-1.5 w-full rounded-xl border-2 px-4 py-3 text-2xl font-bold tabular-nums outline-none" />
          {Math.abs(diff) > 0.005 && (
            <p className={`mt-1 text-[11px] font-medium ${diff < 0 ? "text-emerald-700" : "text-amber-700"}`}>
              {diff < 0 ? `${formatINR(-diff)} less than the statement → cashback / savings on this card.` : `${formatINR(diff)} more than the statement → fees / charges on this card.`}
            </p>
          )}
        </div>
        {bankAccts.length > 0 && (
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-slate-600">Paid the whole bill from</label>
            <select name="fromAccountId" required value={fromId} onChange={(e) => setFromId(e.target.value)} className="input mt-1.5 w-full">
              <option value="" disabled>Pick the account</option>
              {bankAccts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">{formatINR(amountNum)} leaves {fromId ? nameOf(fromId) : "that account"} · the card&apos;s {formatINR(familyPart)} family share is cleared from the family In-Hand.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {familyPart > 0.005 && (
              <label className="block">
                <span className="text-[11px] font-medium text-slate-500">👪 Family share {formatINR(familyPart)} is in</span>
                <select name="familyFromId" required value={familyFromId} onChange={(e) => setFamilyFromId(e.target.value)} className="input mt-1 w-full py-1.5 text-sm">
                  <option value="" disabled>Pick</option>
                  {bankAccts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            )}
            {fromYou > 0.005 && (
              <label className="block">
                <span className="text-[11px] font-medium text-slate-500">👤 Your share {formatINR(fromYou)} is in</span>
                <select name="personalFromId" required value={personalFromId} onChange={(e) => setPersonalFromId(e.target.value)} className="input mt-1 w-full py-1.5 text-sm">
                  <option value="" disabled>Pick</option>
                  {bankAccts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            )}
          </div>
          {fromId && moves.length > 0 && (
            <div className="rounded-lg bg-sky-50 p-2.5 text-[12px] text-sky-900">
              <p className="font-medium">Adds {moves.length === 1 ? "a step" : "steps"} to your plan:</p>
              <ul className="mt-0.5 space-y-0.5">
                {moves.map((m) => <li key={m.what}>↔ {nameOf(m.from)} → {nameOf(fromId)} · {formatINR(m.amt)} <span className="text-sky-700">({m.what})</span></li>)}
              </ul>
              <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[12px] font-medium text-sky-900">
                <input type="checkbox" name="movedNow" checked={movedNow} onChange={(e) => setMovedNow(e.target.checked)} className="h-4 w-4 accent-sky-600" />
                Already moved — mark {moves.length === 1 ? "it" : "them"} done now
              </label>
              {!movedNow && <p className="mt-0.5 text-[11px] text-sky-700">{moves.length === 1 ? "It waits" : "They wait"} in your plan — tick when you move the money; balances follow.</p>}
            </div>
          )}
        </div>
        )}
        <div className="flex items-center gap-3 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-xl border-2 border-slate-200 px-4 py-2 text-base font-medium text-slate-600">Cancel</button>
          <button type="submit" disabled={Number.isNaN(amountNum) || amountNum < 0 || (bankAccts.length > 0 && (!fromId || (familyPart > 0.005 && !familyFromId) || (fromYou > 0.005 && !personalFromId)))} style={{ backgroundColor: card.color }} className="min-h-11 flex-1 rounded-xl px-4 py-2 text-base font-semibold text-white disabled:opacity-40">Pay bill</button>
        </div>
      </form>
    </Overlay>
  );
}

// A compact per-step day field that re-dates the step when you leave it.
function DayEdit({ id, day }: { id: number; day: number | null }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={redatePlanStep} className="mt-0.5 flex items-center justify-end gap-1">
      <input type="hidden" name="id" value={id} />
      <span className="text-[10px] text-slate-400">day</span>
      <input
        name="dayOfMonth"
        type="number"
        min={1}
        max={28}
        defaultValue={day ?? ""}
        onBlur={() => ref.current?.requestSubmit()}
        className="w-11 rounded border border-slate-200 px-1 py-0.5 text-right text-[11px] tabular-nums outline-none focus:border-emerald-400"
      />
    </form>
  );
}

function AddStepModal({ periodId, accounts, categories, after, onClose }: { periodId: number; accounts: Acct[]; categories: Cat[]; after: number | "top"; onClose: () => void }) {
  const toast = useToast();
  const prevN = useRef(0);
  const [kind, setKind] = useState("expense");
  const [state, formAction] = useActionState(addPlanStep, { ok: false, n: 0 } as PersonalSaveState);
  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      if (state.ok) { toast("Step added", "success"); onClose(); } else toast(state.error ?? "Couldn't add", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  const needsFrom = kind !== "income";
  const needsTo = kind === "transfer" || kind === "income";
  const fromList = kind === "transfer" ? accounts.filter((a) => BALANCE_TYPES.has(a.type)) : accounts;
  const hasCategory = kind === "expense" || kind === "spend";
  const placeholder = { income: "e.g. Freelance payout", transfer: "e.g. Move to HDFC", save: "e.g. Extra to savings", expense: "e.g. Insurance", spend: "e.g. Groceries top-up" }[kind];

  return (
    <Overlay onClose={onClose} title="Add a step">
      <form action={formAction} className="flex flex-col">
        <div className="space-y-4 px-5 py-4">
          <input type="hidden" name="periodId" value={periodId} />
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="afterStepId" value={String(after)} />
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            {after === "top" ? "Goes at the top of" : "Goes right after the chosen row in"} this month&apos;s plan — this month only.
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {(["income", "expense", "transfer", "save"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={`rounded-lg border-2 px-1 py-2 text-[11px] font-medium ${kind === k ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"}`}>
                <span className="block">{KIND_ICON[k]}</span>{KIND_NAME[k]}
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Name</label>
            <input name="label" required placeholder={placeholder} className="input mt-1 w-full" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-slate-500">Amount (₹)</label>
              <input name="amount" type="number" step="0.01" inputMode="decimal" required placeholder="0" className="input mt-1 w-full" />
            </div>
            <div className="w-24">
              <label className="text-xs font-medium text-slate-500">Day</label>
              <input name="dayOfMonth" type="number" min={1} max={28} placeholder="—" className="input mt-1 w-full" />
            </div>
          </div>
          {hasCategory && (
            <div>
              <label className="text-xs font-medium text-slate-500">{kind === "spend" ? "Category" : "Category (optional)"}</label>
              <select name="categoryId" required={kind === "spend"} defaultValue="" className="input mt-1 w-full">
                <option value="">{kind === "spend" ? "Pick a category" : "— none —"}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.name}</option>)}
              </select>
            </div>
          )}
          {needsFrom && (
            <div>
              <label className="text-xs font-medium text-slate-500">{kind === "transfer" ? "Sender account" : "Paid from (optional)"}</label>
              <select name="fromAccountId" required={kind === "transfer"} defaultValue="" className="input mt-1 w-full">
                <option value="">{kind === "transfer" ? "Pick an account" : "— ask me when I mark it paid —"}</option>
                {fromList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
          {needsTo && (
            <div>
              <label className="text-xs font-medium text-slate-500">{kind === "income" ? "Received into (optional)" : "Receiver account"}</label>
              <select name="toAccountId" required={kind === "transfer"} defaultValue="" className="input mt-1 w-full">
                <option value="">{kind === "income" ? "— budget only —" : "Pick an account"}</option>
                {accounts.filter((a) => BALANCE_TYPES.has(a.type)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600">Cancel</button>
          <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Add</button>
        </div>
      </form>
    </Overlay>
  );
}
