"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { transferBetweenAccounts, type TransferState } from "@/app/personal/finance/actions";
import { formatINR } from "@/lib/format";
import { useToast } from "@/components/Toast";

const INIT: TransferState = { ok: false, n: 0 };

type Acct = { id: number; name: string; balance: number; color: string };

// The Money Plan's "move money between your accounts" tool. Records a transfer as two ledger legs
// (out of one balance account, into another) so both balances update. Auto-closes on success.
export function TransferModal({ accounts }: { accounts: Acct[] }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const prevN = useRef(0);
  const [state, formAction] = useActionState(transferBetweenAccounts, INIT);

  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      if (state.ok) {
        toast("Transfer recorded", "success");
        formRef.current?.reset();
        // eslint-disable-next-line react-hooks/set-state-in-effect -- close the modal once the server action resolves
        setOpen(false);
      } else toast(state.error ?? "Couldn't record", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  const canTransfer = accounts.length >= 2;

  return (
    <>
      <button
        onClick={() => canTransfer && setOpen(true)}
        disabled={!canTransfer}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
        title={canTransfer ? undefined : "Add at least two bank/debit accounts to move money between them"}
      >
        ↔ Move money
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClick={() => setOpen(false)}>
          <div className="my-auto flex w-full max-w-md flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-lg font-bold text-slate-900">Move money</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
            </div>
            <form ref={formRef} action={formAction} className="flex flex-col">
              <div className="space-y-4 px-5 py-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="From">
                    <select name="fromId" required defaultValue="" className="input w-full">
                      <option value="" disabled>Choose account</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} · {formatINR(a.balance)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="To">
                    <select name="toId" required defaultValue="" className="input w-full">
                      <option value="" disabled>Choose account</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} · {formatINR(a.balance)}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Amount (₹) *">
                  <input name="amount" inputMode="numeric" required placeholder="0" className="input w-full" />
                </Field>
                <Field label="Note (optional)">
                  <input name="note" placeholder="e.g. for the home-loan EMI" className="input w-full" />
                </Field>
                <p className="text-[11px] text-slate-400">
                  This records the move on both accounts&apos; balances. It doesn&apos;t touch your bank — make the
                  actual transfer in your banking app, then log it here.
                </p>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600">Cancel</button>
                <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Record transfer</button>
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
