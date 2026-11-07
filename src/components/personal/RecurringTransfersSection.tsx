"use client";

import { useState } from "react";
import { formatINR } from "@/lib/format";
import { RowActions } from "@/components/RowActions";
import { deletePlanItem, applyPlanItemToMonth } from "@/app/personal/finance/actions";
import { ApplyToMonth, type MonthNote } from "@/components/personal/ApplyToMonth";
import { PlanItemModal } from "@/components/personal/PlanItemModal";

type Acct = { id: number; name: string; balance: number };
type Item = {
  id: number; kind: string; label: string; amount: number;
  dayOfMonth: number | null; fromAccountId: number | null; toAccountId: number | null; note: string | null;
  month?: MonthNote | null; // this month's own step vs. this template
  holdingId?: number | null;
};

// Setup section: the member's repeating account-to-account transfers + savings moves. These are the
// templates that generate a transfer/save step on the Money Plan each month. Pure CRUD — execution (the
// "done" tick) lives on the plan itself now.
export function RecurringTransfersSection({ items, accounts, periodId = null, holdings = [] }: { items: Item[]; accounts: Acct[]; periodId?: number | null; holdings?: { id: number; name: string }[] }) {
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const nameOf = (id: number | null) => (id == null ? null : accounts.find((a) => a.id === id)?.name ?? null);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">🔁 Recurring transfers &amp; savings</h2>
          <p className="mt-0.5 text-xs text-slate-500">Money you move between your own accounts (or into savings) every month — each new month gets it as a step on your plan. Changes here apply from next month.</p>
        </div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          + Add
        </button>
      </div>

      <div className="mt-3 divide-y divide-slate-100">
        {items.length === 0 ? (
          <p className="py-2 text-sm text-slate-400">None yet.</p>
        ) : (
          items.map((m) => (
            <div key={m.id} className="py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 truncate text-slate-700">
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-slate-500" title="Day of month">{m.dayOfMonth ?? "—"}</span>
                <span className="truncate">
                  {m.kind === "transfer" ? "↔" : "🐷"} {m.label}
                  <span className="ml-1 text-[11px] text-slate-400">
                    {m.kind === "transfer"
                      ? `${nameOf(m.fromAccountId) ?? "?"} → ${nameOf(m.toAccountId) ?? "?"}`
                      : `${nameOf(m.fromAccountId) ? nameOf(m.fromAccountId) + " → " : ""}savings`}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums font-medium text-slate-800">{formatINR(m.amount)}</span>
                <RowActions id={m.id} deleteAction={deletePlanItem} onEdit={() => setEditing(m)} />
              </span>
            </div>
            <ApplyToMonth note={m.month ?? null} id={m.id} periodId={periodId} action={applyPlanItemToMonth} />
            </div>
          ))
        )}
      </div>

      <PlanItemModal
        key={editing && editing !== "new" ? String(editing.id) : "new"}
        accounts={accounts}
        holdings={holdings}
        open={editing != null}
        onOpenChange={(v) => { if (!v) setEditing(null); }}
        initial={
          editing && editing !== "new"
            ? { id: editing.id, kind: editing.kind, label: editing.label, amount: editing.amount, dayOfMonth: editing.dayOfMonth, fromAccountId: editing.fromAccountId, toAccountId: editing.toAccountId, note: editing.note, holdingId: editing.holdingId }
            : null
        }
      />
    </section>
  );
}
