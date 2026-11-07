"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useSavingToast } from "@/components/useSavingToast";
import { addNetWorthItem, updateNetWorthItem, type ItemFormState } from "@/app/personal/finance/actions";
import { ASSET_TYPES, LIABILITY_TYPES } from "@/lib/finance/types";
import { useToast } from "@/components/Toast";

const INIT: ItemFormState = { ok: false, n: 0 };

type Initial = { id: number; type: string; name: string; value: number; quantity: number | null; institution: string | null; notes: string | null; startDate?: string | null; tenureMonths?: number | null; interestRate?: number | null };

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
  const [state, formAction, saving] = useActionState(isEdit ? updateNetWorthItem : addNetWorthItem, INIT);
  useSavingToast(saving); // hide + "Saving…" while the server works; the result toast replaces it
  const types = category === "asset" ? ASSET_TYPES : LIABILITY_TYPES;
  const [type, setType] = useState(initial?.type ?? "");
  const isDeposit = type === "fd" || type === "rd";

  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      if (state.ok) {
        toast(isEdit ? "Updated" : "Added", "success");
        if (!isEdit) formRef.current?.reset();
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot close after the server action resolves
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
        <div className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center${saving ? " hidden" : ""}`} onClick={() => setOpen(false)}>
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
                    <select name="type" required value={type} onChange={(e) => setType(e.target.value)} className="input w-full">
                      <option value="" disabled>Choose…</option>
                      {types.map((t) => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
                    </select>
                  )}
                </Field>

                <Field label="Name *">
                  <input name="name" required defaultValue={initial?.name ?? ""} placeholder={category === "asset" ? "e.g. Groww MF, SBI MOD FD, Gold ETF" : "e.g. HDFC home loan"} className="input w-full" />
                </Field>

                {/* An asset's value changes through "Update value" / money in-out once it exists (so it's in the
                    history); a liability's balance is edited here. */}
                {!(isEdit && category === "asset") && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={category === "asset" ? "Worth today (₹) *" : "Balance owed (₹) *"}>
                      <input name="value" inputMode="decimal" required defaultValue={initial?.value ?? ""} placeholder="500000" className="input w-full" />
                    </Field>
                    {category === "asset" && !isEdit ? (
                      <Field label="Invested so far (₹)">
                        <input name="invested" inputMode="decimal" placeholder="same as worth" className="input w-full" />
                      </Field>
                    ) : (
                      <Field label="Quantity (optional)">
                        <input name="quantity" inputMode="decimal" defaultValue={initial?.quantity ?? ""} placeholder="units / grams" className="input w-full" />
                      </Field>
                    )}
                  </div>
                )}
                {category === "asset" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={isDeposit ? "Booked on" : "Started on (optional)"}>
                      <input name="startDate" type="date" required={isDeposit} defaultValue={initial?.startDate ? initial.startDate.slice(0, 10) : ""} className="input w-full" />
                    </Field>
                    {isEdit && !isDeposit && (
                      <Field label="Quantity (optional)">
                        <input name="quantity" inputMode="decimal" defaultValue={initial?.quantity ?? ""} placeholder="units / grams" className="input w-full" />
                      </Field>
                    )}
                  </div>
                )}
                {category === "asset" && isDeposit && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Tenure (years) *">
                      <input name="tenureYears" inputMode="decimal" required defaultValue={initial?.tenureMonths != null ? String(Math.round((initial.tenureMonths / 12) * 100) / 100) : ""} placeholder="e.g. 1 or 2.5" className="input w-full" />
                    </Field>
                    <Field label="Interest (% a year) *">
                      <input name="interestRate" inputMode="decimal" required defaultValue={initial?.interestRate ?? ""} placeholder="e.g. 7.1" className="input w-full" />
                    </Field>
                    <p className="col-span-2 -mt-1 text-[11px] text-slate-400">Maturity date and value are worked out for you (quarterly compounding, like Indian bank FDs).</p>
                  </div>
                )}

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
