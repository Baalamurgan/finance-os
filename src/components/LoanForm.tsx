"use client";

// ── Loan / chit predictor form (create + edit) ────────────────────────────────────────────────────
// You type what you know — principal, rate, tenure OR EMI, start date, current remaining — and it LIVE-
// PREVIEWS the EMI, payoff date, remaining months, and total interest before you save (a "loan predictor").
// For a mid-life loan, set the current outstanding to your real balance. Chits switch to a simple set of
// fields (installments + pot). Submits through the existing createLoan / updateLoan server actions, so all
// the projection/strategy math downstream just works from the saved fields.

import { useMemo, useState } from "react";
import { ToastForm } from "@/components/ToastForm";
import { formatINR } from "@/lib/format";
import { emiFor, amortize } from "@/lib/loan/amortize";
import { createLoan, updateLoan } from "@/app/actions";

type Member = { id: number; name: string };
export type LoanFormLoan = {
  id: number; name: string; kind: string; outstanding: number; monthlyAmount: number; memberId: number | null;
  originalPrincipal: number | null; interestRate: number | null; originalTenureMonths: number | null;
  startDate: string | null; emiAmount: number | null; prepaymentStrategy: string;
  totalInstallments: number | null; paidInstallments: number; note: string | null;
};

const numOr = (s: string): number | null => { const v = s.trim(); if (v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "—");
const fmtMonths = (m: number) => (m >= 12 ? `${Math.floor(m / 12)}y ${m % 12}m` : `${m} months`);

export function LoanForm({ mode, householdId, members, loan }: { mode: "create" | "edit"; householdId?: number; members: Member[]; loan?: LoanFormLoan }) {
  const [kind, setKind] = useState(loan?.kind ?? "loan");
  const [name, setName] = useState(loan?.name ?? "");
  const [memberId, setMemberId] = useState(loan?.memberId != null ? String(loan.memberId) : "");
  const [note, setNote] = useState(loan?.note ?? "");
  // loan fields
  const [principal, setPrincipal] = useState(loan?.originalPrincipal != null ? String(loan.originalPrincipal) : "");
  const [outstanding, setOutstanding] = useState(loan?.outstanding ? String(loan.outstanding) : "");
  const [rate, setRate] = useState(loan?.interestRate != null ? String(loan.interestRate) : "");
  const [tenure, setTenure] = useState(loan?.originalTenureMonths != null ? String(loan.originalTenureMonths) : "");
  const [emi, setEmi] = useState(loan?.emiAmount != null ? String(loan.emiAmount) : "");
  const [start, setStart] = useState(loan?.startDate ? loan.startDate.slice(0, 10) : "");
  const [strategy, setStrategy] = useState(loan?.prepaymentStrategy ?? "reduce_tenure");
  // chit fields
  const [monthly, setMonthly] = useState(loan?.monthlyAmount ? String(loan.monthlyAmount) : "");
  const [totalInst, setTotalInst] = useState(loan?.totalInstallments != null ? String(loan.totalInstallments) : "");
  const [paidInst, setPaidInst] = useState(loan?.paidInstallments ? String(loan.paidInstallments) : "");

  // Live projection preview for a loan (pure client-side amortization).
  const preview = useMemo(() => {
    if (kind !== "loan") return null;
    const P = numOr(principal), r = numOr(rate), n = numOr(tenure), e = numOr(emi), out = numOr(outstanding);
    if (r == null || r <= 0) return null;
    const emiUsed = e && e > 0 ? e : P && n && n > 0 ? emiFor(P, r, n) : 0;
    const opening = out && out > 0 ? out : P && P > 0 ? P : 0;
    if (emiUsed <= 0 || opening <= 0) return null;
    try {
      const res = amortize({ principal: opening, annualRatePct: r, emi: emiUsed, startDate: start || undefined, maxMonths: 600 });
      const closes = res.rows.length > 0 && res.rows[res.rows.length - 1].balance <= 0.005;
      const monthlyInterest = Math.round(opening * (r / 1200) * 100) / 100;
      return { emiUsed, closes, months: res.months, closureDate: res.closureDate, totalInterest: res.totalInterest, monthlyInterest };
    } catch { return null; }
  }, [kind, principal, rate, tenure, emi, outstanding, start]);

  const action = mode === "create" ? createLoan : updateLoan;

  return (
    <ToastForm action={action} successMessage={mode === "create" ? "Loan added" : "Loan updated"} className="space-y-3">
      {mode === "create" ? <input type="hidden" name="householdId" value={householdId} /> : <input type="hidden" name="loanId" value={loan!.id} />}
      <input type="hidden" name="note" value={note} />

      {mode === "create" && (
        <div className="flex gap-2">
          {(["loan", "chit"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium capitalize ${kind === k ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
              {k}
            </button>
          ))}
          <input type="hidden" name="kind" value={kind} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Name" wide>
          <input name="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BOB loan" className="input mt-0.5 block w-full" />
        </Field>
        <Field label="Responsible">
          <select name="memberId" value={memberId} onChange={(e) => setMemberId(e.target.value)} className="input mt-0.5 block w-full">
            <option value="">Shared</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>

        {kind === "loan" ? (
          <>
            <Field label="Original principal (₹)">
              <input name="originalPrincipal" type="number" step="0.01" value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="e.g. 4480000" className="input mt-0.5 block w-full" />
            </Field>
            <Field label="Current remaining (₹)">
              <input name="outstanding" type="number" step="0.01" value={outstanding} onChange={(e) => setOutstanding(e.target.value)} placeholder="what's left now" className="input mt-0.5 block w-full" />
            </Field>
            <Field label="Interest rate (% p.a.)">
              <input name="interestRate" type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 8.5" className="input mt-0.5 block w-full" />
            </Field>
            <Field label="Tenure (months)">
              <input name="originalTenureMonths" type="number" value={tenure} onChange={(e) => setTenure(e.target.value)} placeholder="e.g. 108" className="input mt-0.5 block w-full" />
            </Field>
            <Field label="EMI (₹, blank = auto)">
              <input name="emiAmount" type="number" step="0.01" value={emi} onChange={(e) => setEmi(e.target.value)} placeholder={preview ? String(Math.round(preview.emiUsed)) : "auto"} className="input mt-0.5 block w-full" />
            </Field>
            <Field label="Start date">
              <input name="startDate" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input mt-0.5 block w-full" />
            </Field>
            <Field label="Extra payments">
              <select name="prepaymentStrategy" value={strategy} onChange={(e) => setStrategy(e.target.value)} className="input mt-0.5 block w-full">
                <option value="reduce_tenure">Finish sooner (reduce tenure)</option>
                <option value="reduce_emi">Lower EMI (keep tenure)</option>
              </select>
            </Field>
          </>
        ) : (
          <>
            <Field label="Monthly amount (₹)">
              <input name="monthlyAmount" type="number" step="0.01" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="e.g. 9100" className="input mt-0.5 block w-full" />
            </Field>
            <Field label="Total installments">
              <input name="totalInstallments" type="number" value={totalInst} onChange={(e) => setTotalInst(e.target.value)} placeholder="e.g. 20" className="input mt-0.5 block w-full" />
            </Field>
            <Field label="Paid so far">
              <input name="paidInstallments" type="number" value={paidInst} onChange={(e) => setPaidInst(e.target.value)} placeholder="0" className="input mt-0.5 block w-full" />
            </Field>
          </>
        )}
        <Field label="Note" wide>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" className="input mt-0.5 block w-full" />
        </Field>
      </div>

      {/* Live predictor preview */}
      {kind === "loan" && (
        preview ? (
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2.5 text-sm">
            {preview.closes ? (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-slate-700">
                <span>EMI <b className="tabular-nums text-indigo-800">{formatINR(preview.emiUsed)}</b></span>
                <span>Pay off by <b className="text-indigo-800">{fmtDate(preview.closureDate)}</b> <span className="text-slate-400">({fmtMonths(preview.months)})</span></span>
                <span>Interest from here <b className="tabular-nums text-rose-600">{formatINR(preview.totalInterest)}</b></span>
              </div>
            ) : (
              <div className="text-slate-700">
                <b className="text-amber-700">Interest-only</b> at this EMI — the balance won&apos;t reduce on its own. Monthly interest ≈ <b className="tabular-nums text-rose-600">{formatINR(preview.monthlyInterest)}</b>. Add extra principal (or a higher EMI) to pay it down.
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400">Enter a rate plus either an EMI or a principal + tenure to see the predicted payoff.</p>
        )
      )}

      <button className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
        {mode === "create" ? "Add loan" : "Save details"}
      </button>
    </ToastForm>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`text-xs text-slate-500 ${wide ? "col-span-2 sm:col-span-1" : ""}`}>
      {label}
      {children}
    </label>
  );
}
