"use client";

import { useState } from "react";
import { recordLoanPayment } from "@/app/actions";
import { formatINR } from "@/lib/format";

// Record a loan/chit payment with a confirm step and an overdraw guard
// (principal paid can't exceed the outstanding balance).
export function LoanPaymentForm({
  loanId,
  periodId,
  kind,
  outstanding,
}: {
  loanId: number;
  periodId: number | null;
  kind: string;
  outstanding: number;
}) {
  const [principal, setPrincipal] = useState(kind === "loan" ? "" : "0");
  const principalNum = Number(principal) || 0;
  const over = principalNum > outstanding;

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-indigo-600">+ Record payment</summary>
      <form
        action={recordLoanPayment}
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          if (!e.currentTarget.checkValidity()) return;
          if (over) {
            e.preventDefault();
            alert(`Principal can't exceed the outstanding ${formatINR(outstanding)}.`);
            return;
          }
          if (!confirm("Record this payment?")) {
            e.preventDefault();
            return;
          }
        }}
      >
        <input type="hidden" name="loanId" value={loanId} />
        {periodId && <input type="hidden" name="periodId" value={periodId} />}
        <label className="text-xs text-slate-500">
          Amount
          <input name="amount" type="number" step="0.01" required className="input mt-0.5 block w-28" />
        </label>
        <label className="text-xs text-slate-500">
          Principal part
          <input
            name="principalPart"
            type="number"
            step="0.01"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            placeholder={kind === "loan" ? "reduces balance" : "0"}
            className={`input mt-0.5 block w-32 ${over ? "border-red-400" : ""}`}
          />
        </label>
        <input name="note" placeholder="note" className="input w-32" />
        <button disabled={over} className="btn disabled:opacity-40">
          Save
        </button>
      </form>
      {kind !== "chit" && (
        <p className={`mt-1 text-[11px] ${over ? "font-medium text-red-600" : "text-slate-400"}`}>
          Outstanding: {formatINR(outstanding)}
        </p>
      )}
    </details>
  );
}
