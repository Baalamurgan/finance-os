"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addPlanItem, updatePlanItem, type PlanItemState } from "@/app/personal/finance/actions";
import { formatINR } from "@/lib/format";
import { useToast } from "@/components/Toast";

const INIT: PlanItemState = { ok: false, n: 0 };

type Acct = { id: number; name: string; balance: number };
type Initial = {
  id: number; kind: string; label: string; amount: number;
  dayOfMonth: number | null; fromAccountId: number | null; toAccountId: number | null; note: string | null;
};

// Create/edit form for a recurring money-plan move. Controlled by RecurringMoves; keyed on the item id
// there so it remounts fresh per item (the kind toggle initialises from `initial` with no sync effect).
export function PlanItemModal({
  accounts,
  open,
  onOpenChange,
  initial,
}: {
  accounts: Acct[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Initial | null;
}) {
  const toast = useToast();
  const isEdit = !!initial;
  const [kind, setKind] = useState<"transfer" | "save">((initial?.kind as "transfer" | "save") ?? "transfer");
  const formRef = useRef<HTMLFormElement>(null);
  const prevN = useRef(0);
  const [state, formAction] = useActionState(isEdit ? updatePlanItem : addPlanItem, INIT);

  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      if (state.ok) {
        toast(isEdit ? "Move updated" : "Move added", "success");
        formRef.current?.reset();
        onOpenChange(false);
      } else toast(state.error ?? "Couldn't save", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  if (!open) return null;
  const isTransfer = kind === "transfer";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClick={() => onOpenChange(false)}>
      <div className="my-auto flex w-full max-w-md flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-bold text-slate-900">{isEdit ? "Edit" : "Add"} repeating move</h2>
          <button type="button" onClick={() => onOpenChange(false)} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>
        <form ref={formRef} action={formAction} className="flex flex-col">
          <div className="space-y-4 px-5 py-4">
            {isEdit && <input type="hidden" name="id" value={initial!.id} />}
            <input type="hidden" name="kind" value={kind} />

            <div className="grid grid-cols-2 gap-2">
              {(["transfer", "save"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`rounded-lg border-2 px-2 py-2 text-xs font-medium ${kind === k ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"}`}
                >
                  {k === "transfer" ? "↔ Transfer" : "🐷 Save"}
                </button>
              ))}
            </div>

            <Field label="Name *">
              <input name="label" required defaultValue={initial?.label ?? ""} placeholder={isTransfer ? "e.g. Move for the EMI" : "e.g. Monthly savings"} className="input w-full" />
            </Field>
            <Field label="Amount (₹) *">
              <input name="amount" inputMode="numeric" required defaultValue={initial?.amount ? String(initial.amount) : ""} placeholder="0" className="input w-full" />
            </Field>
            <Field label={isTransfer ? "From account *" : "From account (optional)"}>
              <select name="fromAccountId" required={isTransfer} defaultValue={initial?.fromAccountId ?? ""} className="input w-full">
                <option value="">{isTransfer ? "Choose account" : "— none —"}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} · {formatINR(a.balance)}</option>
                ))}
              </select>
            </Field>
            {isTransfer && (
              <Field label="To account *">
                <select name="toAccountId" required defaultValue={initial?.toAccountId ?? ""} className="input w-full">
                  <option value="">Choose account</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} · {formatINR(a.balance)}</option>
                  ))}
                </select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Day of month">
                <input name="dayOfMonth" inputMode="numeric" defaultValue={initial?.dayOfMonth ?? ""} placeholder="1–28" className="input w-full" />
              </Field>
            </div>
            <Field label="Note (optional)">
              <input name="note" defaultValue={initial?.note ?? ""} placeholder="reminder to yourself" className="input w-full" />
            </Field>
            <p className="text-[11px] text-slate-400">
              {isTransfer
                ? "Shows on your plan each month. “Do it” records the move on both accounts’ balances."
                : "Shows on your plan each month. “Do it” sets the amount aside into your savings pot."}
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600">Cancel</button>
            <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">{isEdit ? "Save" : "Add move"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}
