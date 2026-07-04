"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addPersonalExpense, updatePersonalExpense, type PersonalSaveState } from "@/app/personal/actions";
import { useToast } from "@/components/Toast";

type Cat = { id: number; name: string; icon: string | null };
type Initial = { id: number; label: string; categoryId: number | null; amount: number; recurring: boolean };
const INIT: PersonalSaveState = { ok: false, n: 0 };

// A monthly expense on the Sheet: name + category + amount + repeats-toggle.
export function PersonalFixedModal({
  periodId,
  categories,
  initial,
  hideTrigger = false,
  controlledOpen,
  onOpenChange,
  defaultRecurring = true,
  triggerLabel = "+ Add expense",
}: {
  periodId: number;
  categories: Cat[];
  initial?: Initial;
  hideTrigger?: boolean;
  controlledOpen?: boolean;
  onOpenChange?: (v: boolean) => void;
  defaultRecurring?: boolean;
  triggerLabel?: string;
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
  const [state, formAction, pending] = useActionState(isEdit ? updatePersonalExpense : addPersonalExpense, INIT);

  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      if (state.ok) {
        toast(isEdit ? "Updated" : "Added", "success");
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
          className="w-full rounded-lg border border-dashed border-emerald-300 px-3 py-2.5 text-left text-sm font-medium text-emerald-700 hover:bg-emerald-50"
        >
          {triggerLabel}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center" onClick={() => setOpen(false)}>
          <div className="my-auto flex w-full max-w-md flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-lg font-bold text-slate-900">{isEdit ? "Edit fixed expense" : "Add fixed expense"}</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">
                ✕
              </button>
            </div>
            <form ref={formRef} action={formAction} className="flex flex-col">
              <div className="space-y-4 px-5 py-4">
                <input type="hidden" name="periodId" value={periodId} />
                {isEdit && <input type="hidden" name="id" value={initial!.id} />}
                <div>
                  <label className="text-xs font-medium text-slate-500">Name</label>
                  <input name="label" required defaultValue={isEdit ? initial!.label : ""} placeholder="e.g. Rent, Netflix" className="input mt-1 w-full" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">Category</label>
                  <select name="categoryId" required defaultValue={isEdit && initial!.categoryId ? String(initial!.categoryId) : ""} className="input mt-1 w-full">
                    <option value="" disabled>Pick a category</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.icon ? `${cat.icon} ` : ""}{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">Amount (₹)</label>
                  <input name="amount" type="number" step="0.01" inputMode="decimal" required defaultValue={isEdit ? initial!.amount : ""} placeholder="0" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-2xl font-bold tabular-nums outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                </div>
                <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <input type="checkbox" name="recurring" defaultChecked={isEdit ? initial!.recurring : defaultRecurring} className="h-4 w-4 accent-emerald-600" />
                  Repeats every month
                </label>
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
