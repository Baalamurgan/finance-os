"use client";

import { useState } from "react";
import { ToastForm } from "@/components/ToastForm";
import { formatINR } from "@/lib/format";
import {
  addPersonalLoan,
  recordPersonalLoanPayment,
  settlePersonalLoan,
  deletePersonalLoan,
} from "@/app/personal/actions";

// ── Shared modal shell ────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="my-auto flex w-full max-w-md flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Create a manual lend / borrow — pick a household member (mirrors to their tab) or type a name;
// a repay-by date is required so both sides get the reminder. ──
export function AddLoanModal({ members = [] }: { members?: { id: number; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"lent" | "borrowed">("lent");
  const [personSel, setPersonSel] = useState(""); // "" none · a member id · "other"
  const isOther = personSel === "other";
  const memberChosen = personSel !== "" && !isOther;
  const memberName = members.find((m) => String(m.id) === personSel)?.name ?? "";
  const dateLabel = direction === "lent" ? "Collect by" : "Repay by";

  return (
    <>
      <button onClick={() => setOpen(true)} className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-center text-sm font-semibold text-white shadow-sm hover:bg-emerald-700">
        + Record lending / borrowing
      </button>

      {open && (
        <Modal title="Record lending / borrowing" onClose={() => setOpen(false)}>
          <ToastForm action={addPersonalLoan} successMessage="Added" onSubmit={() => setOpen(false)} className="flex flex-col">
            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setDirection("lent")} className={`rounded-lg border px-3 py-2 text-sm font-medium ${direction === "lent" ? "border-emerald-400 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-500"}`}>I lent →</button>
                <button type="button" onClick={() => setDirection("borrowed")} className={`rounded-lg border px-3 py-2 text-sm font-medium ${direction === "borrowed" ? "border-amber-400 bg-amber-50 text-amber-800" : "border-slate-200 text-slate-500"}`}>← I borrowed</button>
              </div>
              <input type="hidden" name="direction" value={direction} />

              <div>
                <label className="text-xs font-medium text-slate-500">Person</label>
                {members.length > 0 ? (
                  <>
                    <select value={personSel} onChange={(e) => setPersonSel(e.target.value)} required className="input mt-1 w-full">
                      <option value="">Choose…</option>
                      <optgroup label="Family members">
                        {members.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
                      </optgroup>
                      <option value="other">Someone else (type a name)</option>
                    </select>
                    {isOther && <input name="counterparty" required autoFocus placeholder="Name" className="input mt-2 w-full" />}
                    {memberChosen && (
                      <>
                        <input type="hidden" name="counterpartyMemberId" value={personSel} />
                        <p className="mt-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-emerald-800">
                          🔗 This also shows in <b>{memberName}</b>&apos;s Lending — as {direction === "lent" ? "money they owe you" : "money they’ll be repaid"}. Settling or deleting either side clears both.
                        </p>
                      </>
                    )}
                  </>
                ) : (
                  <input name="counterparty" required placeholder="Who?" className="input mt-1 w-full" autoFocus />
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-slate-500">Amount (₹)</label>
                <input name="amount" type="number" step="0.01" inputMode="decimal" required placeholder="0" className="input mt-1 w-full text-lg font-semibold tabular-nums" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">Note</label>
                <input name="note" placeholder="What for? (optional)" className="input mt-1 w-full" />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex-1">
                    <span className="text-[11px] font-medium text-slate-600">{dateLabel} *</span>
                    <input name="repayBy" type="date" required className="input mt-0.5 w-full py-1.5 text-sm" />
                  </label>
                  <label>
                    <span className="text-[11px] font-medium text-slate-600">Remind (days before)</span>
                    <input name="notifyDaysBefore" type="number" min="0" step="1" defaultValue="3" className="input mt-0.5 w-24 py-1.5 text-sm" />
                  </label>
                  <p className="w-full text-[11px] text-slate-400">Nudges {memberChosen ? "both of you" : "you"} from that many days before — in the bell and the top bar — until it&apos;s settled.</p>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
              <button type="submit" className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">Add</button>
            </div>
          </ToastForm>
        </Modal>
      )}
    </>
  );
}

// ── Per-row actions (record part-payment · mark settled · delete), one clean menu ──
export type LoanRow = {
  id: number;
  counterparty: string;
  amount: number;
  outstanding: number;
  note: string | null;
  sharedPaid: number | null;
  dueISO: string | null;
  cardName: string | null;
  isPeer: boolean;
  accent: "emerald" | "amber";
};

export function LoanRowActions({ loan }: { loan: LoanRow }) {
  const [open, setOpen] = useState(false);
  const receiveVerb = loan.accent === "emerald" ? "Mark received" : "Mark repaid";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
        Manage
      </button>

      {open && (
        <Modal title={loan.counterparty} onClose={() => setOpen(false)}>
          <div className="space-y-4 px-5 py-4">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-slate-500">{loan.accent === "emerald" ? "Owed to you" : "You owe"}</span>
                <span className={`text-xl font-bold tabular-nums ${loan.accent === "emerald" ? "text-emerald-700" : "text-amber-700"}`}>{formatINR(loan.outstanding)}</span>
              </div>
              {loan.note && <p className="mt-1 text-xs text-slate-500">{loan.note}</p>}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {loan.isPeer && loan.cardName && (
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">💳 {loan.cardName}</span>
                )}
                {loan.dueISO && (
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                    📅 {loan.accent === "emerald" ? "collect" : "repay"} by {fmtDate(loan.dueISO)}
                    {loan.isPeer && <span className="ml-1 text-slate-400">· auto</span>}
                  </span>
                )}
              </div>
            </div>

            {/* record a part-payment */}
            <ToastForm action={recordPersonalLoanPayment} successMessage="Payment recorded" onSubmit={() => setOpen(false)}>
              <input type="hidden" name="id" value={loan.id} />
              <label className="text-xs font-medium text-slate-500">Record a part payment</label>
              <div className="mt-1 flex gap-2">
                <input name="amount" type="number" step="0.01" inputMode="decimal" placeholder="₹ received" className="input flex-1" />
                <button type="submit" className="rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">Record</button>
              </div>
            </ToastForm>

            <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
              <ToastForm action={settlePersonalLoan} successMessage="Settled" onSubmit={() => setOpen(false)} className="flex-1">
                <input type="hidden" name="id" value={loan.id} />
                <button type="submit" className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">✓ {receiveVerb} in full</button>
              </ToastForm>
              <ToastForm action={deletePersonalLoan} successMessage="Deleted" onSubmit={() => setOpen(false)}>
                <input type="hidden" name="id" value={loan.id} />
                <button type="submit" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-500 hover:border-red-300 hover:text-red-600">Delete</button>
              </ToastForm>
            </div>
            {loan.isPeer && (
              <p className="text-[11px] text-slate-400">
                {loan.cardName
                  ? "This is a card-fronted debt — settling or deleting it here clears it for both of you."
                  : `Shared with ${loan.counterparty} — settling or deleting it here clears it for both of you.`}
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
