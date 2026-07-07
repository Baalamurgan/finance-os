"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addNetWorthItem, updateNetWorthItem, type ItemFormState } from "@/app/personal/finance/actions";
import { ASSET_TYPES, LIABILITY_TYPES } from "@/lib/finance/types";
import { useToast } from "@/components/Toast";

const INIT: ItemFormState = { ok: false, n: 0 };

type Initial = { id: number; type: string; name: string; value: number; quantity: number | null; institution: string | null; notes: string | null };

// Add or edit a net-worth holding. One component, two modes (mirrors PersonalFixedModal).
export function NetWorthItemModal({
  category,
  initial,
  trigger,
}: {
  category: "asset" | "liability";
  initial?: Initial;
  trigger?: "button" | "pencil";
}) {
  const toast = useToast();
  const isEdit = !!initial;
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const prevN = useRef(0);
  const [state, formAction] = useActionState(isEdit ? updateNetWorthItem : addNetWorthItem, INIT);
  const types = category === "asset" ? ASSET_TYPES : LIABILITY_TYPES;

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
      {trigger === "pencil" ? (
        <button onClick={() => setOpen(true)} aria-label="Edit" className="text-slate-300 hover:text-emerald-600">✎</button>
      ) : (
        <button onClick={() => setOpen(true)} className="rounded-lg border border-dashed border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
          + Add {category === "asset" ? "asset" : "liability"}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClick={() => setOpen(false)}>
          <div className="my-auto flex w-full max-w-md flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-lg font-bold text-slate-900">
                {isEdit ? "Edit" : "Add"} {category === "asset" ? "asset" : "liability"}
              </h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
            </div>
            <form ref={formRef} action={formAction} className="flex flex-col">
              <div className="space-y-4 px-5 py-4">
                <input type="hidden" name="category" value={category} />
                {isEdit && <input type="hidden" name="id" value={initial!.id} />}

                <Field label="Type">
                  {isEdit ? (
                    <input value={types.find((t) => t.key === initial!.type)?.label ?? initial!.type} disabled className="input w-full bg-slate-50 text-slate-500" />
                  ) : (
                    <select name="type" required defaultValue="" className="input w-full">
                      <option value="" disabled>Choose…</option>
                      {types.map((t) => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
                    </select>
                  )}
                </Field>

                <Field label="Name *">
                  <input name="name" required defaultValue={initial?.name ?? ""} placeholder={category === "asset" ? "e.g. HDFC MF, SBI FD, Flat in Chennai" : "e.g. HDFC home loan"} className="input w-full" />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Current value (₹) *">
                    <input name="value" inputMode="numeric" required defaultValue={initial?.value ?? ""} placeholder="500000" className="input w-full" />
                  </Field>
                  <Field label="Quantity (optional)">
                    <input name="quantity" inputMode="numeric" defaultValue={initial?.quantity ?? ""} placeholder="units / grams" className="input w-full" />
                  </Field>
                </div>

                <Field label="Institution (optional)">
                  <input name="institution" defaultValue={initial?.institution ?? ""} placeholder="broker / bank / fund house" className="input w-full" />
                </Field>
                <Field label="Notes (optional)">
                  <input name="notes" defaultValue={initial?.notes ?? ""} className="input w-full" />
                </Field>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600">Cancel</button>
                <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">{isEdit ? "Save" : "Add"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
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
