"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addAccount, type AccountFormState } from "@/app/personal/finance/actions";
import { CARD_NETWORKS } from "@/lib/finance/types";
import { useToast } from "@/components/Toast";

const INIT: AccountFormState = { ok: false, n: 0 };

export function AddAccountModal() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"credit_card" | "debit_card">("credit_card");
  const formRef = useRef<HTMLFormElement>(null);
  const prevN = useRef(0);
  const [state, formAction] = useActionState(addAccount, INIT);

  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      if (state.ok) {
        toast("Card added", "success");
        formRef.current?.reset();
        setOpen(false);
      } else toast(state.error ?? "Couldn't add", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  const isCredit = type === "credit_card";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
      >
        + Add card
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClick={() => setOpen(false)}>
          <div className="my-auto flex w-full max-w-md flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-lg font-bold text-slate-900">Add card</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
            </div>
            <form ref={formRef} action={formAction} className="flex flex-col">
              <div className="space-y-4 px-5 py-4">
                <input type="hidden" name="type" value={type} />

                {/* type toggle */}
                <div className="grid grid-cols-2 gap-2">
                  {(["credit_card", "debit_card"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      className={`rounded-lg border-2 px-3 py-2 text-sm font-medium ${type === t ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"}`}
                    >
                      {t === "credit_card" ? "Credit card" : "Debit card"}
                    </button>
                  ))}
                </div>

                <Field label="Card name *">
                  <input name="name" required placeholder="e.g. SBI SimplyClick" className="input w-full" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Bank / issuer">
                    <input name="institution" placeholder="SBI" className="input w-full" />
                  </Field>
                  <Field label="Last 4 digits">
                    <input name="last4" inputMode="numeric" maxLength={4} placeholder="1234" className="input w-full" />
                  </Field>
                </div>
                <Field label="Network">
                  <select name="network" className="input w-full">
                    <option value="">—</option>
                    {CARD_NETWORKS.map((nw) => (
                      <option key={nw} value={nw}>{nw[0].toUpperCase() + nw.slice(1)}</option>
                    ))}
                  </select>
                </Field>

                {isCredit && (
                  <div className="space-y-3 rounded-lg bg-slate-50 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Credit details (optional — drives the dashboard)</p>
                    <Field label="Credit limit (₹)">
                      <input name="creditLimit" inputMode="numeric" placeholder="100000" className="input w-full" />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Statement day (1–28)">
                        <input name="statementDay" inputMode="numeric" placeholder="15" className="input w-full" />
                      </Field>
                      <Field label="Due after (days)">
                        <input name="dueOffsetDays" inputMode="numeric" placeholder="18" className="input w-full" />
                      </Field>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600">Cancel</button>
                <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Add</button>
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
