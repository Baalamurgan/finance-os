"use client";

import { useState } from "react";
import { formatINR } from "@/lib/format";
import { ToastForm } from "@/components/ToastForm";
import { RowActions } from "@/components/RowActions";
import { runPlanItem, deletePlanItem } from "@/app/personal/finance/actions";
import { PlanItemModal } from "@/components/personal/PlanItemModal";
import type { RecurringMove } from "@/lib/personal/plan";

type Acct = { id: number; name: string; balance: number };

// The maintainable list of monthly repeating moves (transfers + savings) on the Money Plan tab.
// Each row shows this month's status (done / "Do it") and edits via the shared kebab. The "Do it"
// button performs the move now (runPlanItem); the plan re-reads it as done on the next render.
export function RecurringMoves({ moves, accounts }: { moves: RecurringMove[]; accounts: Acct[] }) {
  const [editing, setEditing] = useState<RecurringMove | "new" | null>(null);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Repeating moves</h2>
          <p className="text-[11px] text-slate-400">Transfers &amp; savings you make every month.</p>
        </div>
        <button onClick={() => setEditing("new")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
          + Add
        </button>
      </div>

      {moves.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">
          No repeating moves yet — add one, e.g. &ldquo;move ₹20,000 to the EMI account on the 5th&rdquo; or &ldquo;save ₹10,000&rdquo;.
        </p>
      ) : (
        <ul className="space-y-2">
          {moves.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-800">
                  <span className="mr-1">{m.kind === "transfer" ? "↔" : "🐷"}</span>{m.label}
                </div>
                <div className="truncate text-[11px] text-slate-400">
                  {m.kind === "transfer"
                    ? `${m.fromName ?? "?"} → ${m.toName ?? "?"}`
                    : `${m.fromName ? m.fromName + " → " : ""}savings pot`}
                  {m.dayOfMonth ? ` · day ${m.dayOfMonth}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums text-sm font-semibold text-slate-800">{formatINR(m.amount)}</span>
                {m.done ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">✓ done</span>
                ) : (
                  <ToastForm action={runPlanItem} successMessage="Done — recorded" className="contents">
                    <input type="hidden" name="id" value={m.id} />
                    <button type="submit" className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Do it</button>
                  </ToastForm>
                )}
                <RowActions id={m.id} deleteAction={deletePlanItem} onEdit={() => setEditing(m)} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <PlanItemModal
        key={editing && editing !== "new" ? String(editing.id) : "new"}
        accounts={accounts}
        open={editing != null}
        onOpenChange={(v) => { if (!v) setEditing(null); }}
        initial={
          editing && editing !== "new"
            ? {
                id: editing.id, kind: editing.kind, label: editing.label, amount: editing.amount,
                dayOfMonth: editing.dayOfMonth, fromAccountId: editing.fromAccountId, toAccountId: editing.toAccountId, note: editing.note,
              }
            : null
        }
      />
    </section>
  );
}
