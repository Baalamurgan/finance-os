"use client";

import { useEffect, useState } from "react";
import { formatINR } from "@/lib/format";
import { depositPersonalSavings, withdrawPersonalSavings } from "@/app/personal/actions";

type HistoryItem = { id: number; amount: number; note: string | null; periodLabel: string | null; createdAtISO: string };

// The personal savings pot — set money aside, and pull it back into any month (where it
// lands as income). Mirrors the family Piggy, scaled down to a single private pot.
export function PersonalSavingsCard({
  balance,
  periodId,
  periodLabel,
  history,
}: {
  balance: number;
  periodId: number;
  periodLabel: string;
  history: HistoryItem[];
}) {
  const [mode, setMode] = useState<null | "add" | "use">(null);

  return (
    <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">🐷 Savings pot</div>
          <div className="mt-0.5 text-2xl font-extrabold tabular-nums text-emerald-800">{formatINR(balance)}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode("add")}
            className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
          >
            + Add
          </button>
          <button
            onClick={() => setMode("use")}
            disabled={balance <= 0}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            Use in {periodLabel}
          </button>
        </div>
      </div>

      {history.length > 0 && (
        <details className="mt-3 border-t border-emerald-100 pt-2">
          <summary className="cursor-pointer text-xs font-medium text-emerald-700">History ({history.length})</summary>
          <ul className="mt-2 divide-y divide-emerald-50 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-1.5">
                <div className="min-w-0">
                  <div className="truncate text-slate-600">{h.note ?? (h.amount >= 0 ? "Added" : "Used")}</div>
                  <div className="text-[11px] text-slate-400">
                    {new Date(h.createdAtISO).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                </div>
                <span className={`tabular-nums font-medium ${h.amount < 0 ? "text-slate-500" : "text-emerald-700"}`}>
                  {h.amount < 0 ? "−" : "+"}
                  {formatINR(Math.abs(h.amount))}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {mode === "add" && <AddModal onClose={() => setMode(null)} />}
      {mode === "use" && <UseModal onClose={() => setMode(null)} periodId={periodId} periodLabel={periodLabel} balance={balance} />}
    </div>
  );
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 text-2xl leading-none text-slate-400 hover:bg-slate-100">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AddModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const amountNum = Number(amount) || 0;
  return (
    <Shell title="Add to savings" onClose={onClose}>
      <form action={depositPersonalSavings} onSubmit={() => setTimeout(onClose, 0)} className="space-y-4 px-5 py-5">
        <div>
          <label className="text-sm font-medium text-slate-600">Amount (₹)</label>
          <input
            name="amount" type="number" step="1" inputMode="numeric" autoFocus required
            value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
            className="mt-1.5 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-3xl font-bold tabular-nums outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
          <p className="mt-1 text-[11px] text-slate-400">Enter a negative amount to deduct/correct the balance.</p>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-600">Note</label>
          <input name="note" placeholder="e.g. Set aside for trip, bonus" className="input mt-1.5 w-full" />
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button type="button" onClick={onClose} className="min-h-12 flex-1 rounded-xl border-2 border-slate-200 px-4 py-3 text-base font-medium text-slate-600">Cancel</button>
          <button type="submit" disabled={amountNum === 0 || Number.isNaN(amountNum)} className="min-h-12 flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-40">
            {amountNum < 0 ? "Remove" : "Add"}
          </button>
        </div>
      </form>
    </Shell>
  );
}

function UseModal({ onClose, periodId, periodLabel, balance }: { onClose: () => void; periodId: number; periodLabel: string; balance: number }) {
  const [amount, setAmount] = useState("");
  const amountNum = Number(amount) || 0;
  const overdraw = amountNum > balance;
  return (
    <Shell title={`Use savings in ${periodLabel}`} onClose={onClose}>
      <form
        action={withdrawPersonalSavings}
        onSubmit={(e) => {
          if (!e.currentTarget.checkValidity()) return;
          if (overdraw) { e.preventDefault(); return; }
          setTimeout(onClose, 0);
        }}
        className="space-y-4 px-5 py-5"
      >
        <input type="hidden" name="periodId" value={periodId} />
        <div>
          <label className="text-sm font-medium text-slate-600">Amount (₹)</label>
          <input
            name="amount" type="number" step="0.01" min="1" inputMode="numeric" autoFocus required
            value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
            className={`mt-1.5 w-full rounded-xl border-2 px-4 py-3 text-3xl font-bold tabular-nums outline-none focus:ring-2 ${
              overdraw ? "border-red-400 focus:border-red-400 focus:ring-red-100" : "border-slate-300 focus:border-emerald-400 focus:ring-emerald-100"
            }`}
          />
          <p className={`mt-1 text-xs ${overdraw ? "font-medium text-red-600" : "text-slate-400"}`}>
            {overdraw ? "More than available — " : "Available: "}{formatINR(balance)}
          </p>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-600">Note</label>
          <input name="note" placeholder="e.g. Topped up this month" className="input mt-1.5 w-full" />
        </div>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          Adds the amount as <b>income</b> to <b>{periodLabel}</b> and reduces the pot. Spend it from any category on the Sheet or Expenses.
        </p>
        <div className="flex items-center gap-3 pt-1">
          <button type="button" onClick={onClose} className="min-h-12 flex-1 rounded-xl border-2 border-slate-200 px-4 py-3 text-base font-medium text-slate-600">Cancel</button>
          <button type="submit" disabled={overdraw || amountNum <= 0} className="min-h-12 flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-40">Use in {periodLabel}</button>
        </div>
      </form>
    </Shell>
  );
}
