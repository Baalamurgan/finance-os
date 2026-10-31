"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  tickPlanStep, untickPlanStep, redatePlanStep, setPlanStepSkipped, addPlanStep, deletePlanStep,
  type PersonalSaveState,
} from "@/app/personal/actions";
import { useToast } from "@/components/Toast";
import { formatINR } from "@/lib/format";

export type PlanStepView = {
  id: number; kind: string; label: string; amount: number; dayOfMonth: number | null;
  status: string; templateKind: string | null; fromName: string | null; toName: string | null;
};
type Acct = { id: number; name: string };

const KIND_ICON: Record<string, string> = { income: "💰", transfer: "🔁", save: "🐷", expense: "🧾", spend: "🛒" };

function flow(s: PlanStepView): string {
  if (s.kind === "income") return s.toName ? `received → ${s.toName}` : "received";
  if (s.kind === "transfer") return `${s.fromName ?? "?"} → ${s.toName ?? "?"}`;
  if (s.kind === "save") return `${s.fromName ? `${s.fromName} ` : ""}→ savings pot`;
  if (s.kind === "expense" || s.kind === "spend") return s.fromName ? `from ${s.fromName}` : "from cash / UPI";
  return "";
}

// The month's executable choreography: one dated checklist. Ticking a step performs the real money move
// (income → credits the account; transfer → moves between accounts; save → savings pot); unticking reverses.
export function PersonalPlanSteps({ steps, accounts, periodId }: { steps: PlanStepView[]; accounts: Acct[]; periodId: number }) {
  const [adding, setAdding] = useState(false);
  const active = steps.filter((s) => s.status !== "skipped");
  const skipped = steps.filter((s) => s.status === "skipped");
  const doneCount = active.filter((s) => s.status === "done").length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">This month&apos;s plan</h2>
          <p className="text-[11px] text-slate-400">Tick each as it happens — it moves the real money.</p>
        </div>
        {active.length > 0 && <span className="shrink-0 text-[11px] font-medium text-slate-400">{doneCount}/{active.length} done</span>}
      </div>

      {steps.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">
          No steps yet. Add recurring income &amp; transfers in{" "}
          <a className="font-medium text-emerald-700 underline" href="/personal/setup">Setup</a>, or add a one-off below.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {active.map((s) => <StepRow key={s.id} s={s} />)}
        </ul>
      )}

      {skipped.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-400">{skipped.length} skipped this month</summary>
          <ul className="mt-1.5 space-y-1.5">{skipped.map((s) => <StepRow key={s.id} s={s} />)}</ul>
        </details>
      )}

      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-3 w-full rounded-lg border border-dashed border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
      >
        + Add one-off step
      </button>
      {adding && <AddStepModal periodId={periodId} accounts={accounts} onClose={() => setAdding(false)} />}
    </section>
  );
}

function StepRow({ s }: { s: PlanStepView }) {
  const done = s.status === "done";
  const skipped = s.status === "skipped";
  const isOneOff = s.templateKind == null;
  return (
    <li className={`flex items-center gap-2.5 rounded-lg border p-2.5 ${done ? "border-emerald-100 bg-emerald-50/60" : skipped ? "border-slate-100 bg-slate-50 opacity-70" : "border-slate-100"}`}>
      {!skipped && (
        <form action={done ? untickPlanStep : tickPlanStep}>
          <input type="hidden" name="id" value={s.id} />
          <button
            type="submit"
            aria-label={done ? "Mark not done" : "Mark done"}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs transition-colors ${done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent hover:border-emerald-400"}`}
          >
            ✓
          </button>
        </form>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="shrink-0">{KIND_ICON[s.kind] ?? "•"}</span>
          <span className={`truncate text-sm ${done ? "text-slate-500" : "text-slate-800"}`}>{s.label}</span>
        </span>
        <span className="block truncate text-[11px] text-slate-400">{flow(s)}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className={`block tabular-nums text-sm font-semibold ${s.kind === "income" ? "text-emerald-700" : "text-slate-800"}`}>{formatINR(s.amount)}</span>
        {!done && !skipped ? (
          <DayEdit id={s.id} day={s.dayOfMonth} />
        ) : (
          s.dayOfMonth != null && <span className="block text-[11px] text-slate-400">day {s.dayOfMonth}</span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {!done && (
          <form action={setPlanStepSkipped}>
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="skip" value={skipped ? "0" : "1"} />
            <button type="submit" className="text-[11px] text-slate-400 hover:text-slate-700">{skipped ? "↩ unskip" : "skip"}</button>
          </form>
        )}
        {isOneOff && (
          <form action={deletePlanStep}>
            <input type="hidden" name="id" value={s.id} />
            <button type="submit" aria-label="Delete" className="text-[11px] text-slate-300 hover:text-red-600">✕</button>
          </form>
        )}
      </span>
    </li>
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

function AddStepModal({ periodId, accounts, onClose }: { periodId: number; accounts: Acct[]; onClose: () => void }) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const prevN = useRef(0);
  const [kind, setKind] = useState("transfer");
  const [state, formAction] = useActionState(addPlanStep, { ok: false, n: 0 } as PersonalSaveState);
  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      if (state.ok) { toast("Step added", "success"); onClose(); } else toast(state.error ?? "Couldn't add", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  const needsFrom = kind === "transfer" || kind === "save";
  const needsTo = kind === "transfer" || kind === "income";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="my-auto flex w-full max-w-md flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-bold text-slate-900">Add one-off step</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>
        <form ref={formRef} action={formAction} className="flex flex-col">
          <div className="space-y-4 px-5 py-4">
            <input type="hidden" name="periodId" value={periodId} />
            <input type="hidden" name="kind" value={kind} />
            <div className="grid grid-cols-3 gap-2">
              {(["income", "transfer", "save"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`rounded-lg border-2 px-1.5 py-2 text-xs font-medium capitalize ${kind === k ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"}`}
                >
                  {KIND_ICON[k]} {k}
                </button>
              ))}
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Name</label>
              <input name="label" required placeholder={kind === "income" ? "e.g. Freelance payout" : kind === "save" ? "e.g. Extra to savings" : "e.g. Move to HDFC"} className="input mt-1 w-full" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-slate-500">Amount (₹)</label>
                <input name="amount" type="number" step="0.01" inputMode="decimal" required placeholder="0" className="input mt-1 w-full" />
              </div>
              <div className="w-28">
                <label className="text-xs font-medium text-slate-500">Day</label>
                <input name="dayOfMonth" type="number" min={1} max={28} placeholder="—" className="input mt-1 w-full" />
              </div>
            </div>
            {needsFrom && (
              <div>
                <label className="text-xs font-medium text-slate-500">{kind === "save" ? "From account (optional)" : "From account"}</label>
                <select name="fromAccountId" defaultValue="" className="input mt-1 w-full">
                  <option value="">{kind === "save" ? "— (unspecified)" : "Pick an account"}</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
            {needsTo && (
              <div>
                <label className="text-xs font-medium text-slate-500">{kind === "income" ? "Into account (optional)" : "To account"}</label>
                <select name="toAccountId" defaultValue="" className="input mt-1 w-full">
                  <option value="">{kind === "income" ? "— (budget only)" : "Pick an account"}</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600">Cancel</button>
            <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Add</button>
          </div>
        </form>
      </div>
    </div>
  );
}
