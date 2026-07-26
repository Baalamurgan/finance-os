"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addPersonalSpend, updatePersonalSpend, type PersonalSaveState } from "@/app/personal/actions";
import { useToast } from "@/components/Toast";
import { formatINR } from "@/lib/format";

type Cat = { id: number; name: string; icon: string | null };
type Card = { id: number; name: string; color: string };
type Initial = { id: number; categoryId: number; amount: number; note: string | null; cardAccountId?: number | null };
const INIT: PersonalSaveState = { ok: false, n: 0 };

// Daily spend (category + amount + note), drawn against the remaining balance.
export function PersonalSpendModal({
  periodId,
  categories,
  cards = [],
  remaining,
  initial,
  hideTrigger = false,
  controlledOpen,
  onOpenChange,
}: {
  periodId: number;
  categories: Cat[];
  cards?: Card[];
  remaining?: number;
  initial?: Initial;
  hideTrigger?: boolean;
  controlledOpen?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const isEdit = !!initial;
  const toast = useToast();
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = (v: boolean) => {
    onOpenChange?.(v);
    if (controlledOpen === undefined) setUncontrolled(v);
  };
  const formRef = useRef<HTMLFormElement>(null);
  const prevN = useRef(0);
  const [state, formAction, pending] = useActionState(isEdit ? updatePersonalSpend : addPersonalSpend, INIT);

  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      if (state.ok) {
        toast(isEdit ? "Updated" : "Spend added", "success");
        if (!isEdit) formRef.current?.reset();
        setOpen(false);
      } else toast(state.error ?? "Couldn't save", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  return (
    <>
      {!hideTrigger && (
        <button
          onClick={() => setOpen(true)}
          className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-center text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
        >
          + Add spend
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClick={() => setOpen(false)}>
          <div className="my-auto flex w-full max-w-md flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-lg font-bold text-slate-900">{isEdit ? "Edit spend" : "Add spend"}</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">
                ✕
              </button>
            </div>
            <form ref={formRef} action={formAction} className="flex flex-col">
              <div className="space-y-4 px-5 py-4">
                <input type="hidden" name="periodId" value={periodId} />
                {isEdit && <input type="hidden" name="id" value={initial!.id} />}
                <div>
                  <label className="text-xs font-medium text-slate-500">Amount (₹)</label>
                  <input name="amount" type="number" step="0.01" inputMode="decimal" autoFocus required defaultValue={isEdit ? initial!.amount : ""} placeholder="0" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-3xl font-bold tabular-nums outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                  {remaining !== undefined && !isEdit && (
                    <p className="mt-1 text-xs text-slate-400">Remaining to spend: {formatINR(remaining)}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">Category</label>
                  <select name="categoryId" required defaultValue={isEdit ? String(initial!.categoryId) : ""} className="input mt-1 w-full">
                    <option value="" disabled>Pick a category</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">Name</label>
                  <input name="note" required defaultValue={isEdit ? (initial!.note ?? "") : ""} placeholder="e.g. Swiggy dinner" className="input mt-1 w-full" />
                </div>
                {cards.length > 0 && (
                  <div>
                    <label className="text-xs font-medium text-slate-500">💳 Paid with</label>
                    <select name="cardAccountId" defaultValue={isEdit ? String(initial!.cardAccountId ?? "") : ""} className="input mt-1 w-full">
                      <option value="">Cash / UPI (from this month)</option>
                      {cards.map((c) => (
                        <option key={c.id} value={c.id}>{c.name} — pay at card bill</option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-slate-400">On a credit card, it&apos;s deferred — it leaves your cash when you mark that card&apos;s bill paid.</p>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
                <button type="submit" disabled={pending} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
                  {pending ? "Saving…" : isEdit ? "Save" : "Add"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
