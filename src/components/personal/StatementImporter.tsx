"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  extractStatement,
  saveImportedTransactions,
  type ExtractedTxn,
  type StatementMeta,
} from "@/app/personal/finance/actions";
import { TXN_TYPES, type TxnType } from "@/lib/finance/types";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function StatementImporter({ accountId }: { accountId: number }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ExtractedTxn[] | null>(null);
  const [meta, setMeta] = useState<StatementMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const runExtract = () => {
    setError(null);
    setOk(null);
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose a PDF statement first.");
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const res = await extractStatement(fd);
      if (res.ok) { setRows(res.transactions); setMeta(res.meta); }
      else setError(res.error);
    });
  };

  const update = (i: number, patch: Partial<ExtractedTxn>) =>
    setRows((rs) => (rs ? rs.map((r, j) => (j === i ? { ...r, ...patch } : r)) : rs));
  const remove = (i: number) => setRows((rs) => (rs ? rs.filter((_, j) => j !== i) : rs));

  const save = () => {
    if (!rows || rows.length === 0) return;
    const fd = new FormData();
    fd.set("accountId", String(accountId));
    fd.set("rows", JSON.stringify(rows));
    start(async () => {
      const res = await saveImportedTransactions(fd);
      if (res.ok) {
        setOk(`Imported ${res.n} transactions.`);
        setRows(null); setMeta(null);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } else setError(res.error ?? "Save failed.");
    });
  };

  // deterministic reconciliation: extracted totals vs the statement's own summary
  const sumBy = (t: string) => (rows ?? []).filter((r) => r.type === t).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const spendSum = sumBy("spend");
  const paySum = sumBy("payment");
  const mismatch = (stated?: number | null, got?: number) =>
    stated != null && got != null && Math.abs(stated - got) > 1;
  const spendOff = mismatch(meta?.totalSpends, spendSum);
  const payOff = mismatch(meta?.totalPayments, paySum);
  const lowConf = (rows ?? []).filter((r) => (r.confidence ?? 1) < 0.6).length;

  return (
    <div className="space-y-3">
      {!rows && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Import a statement (PDF)</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Upload your monthly PDF — it&apos;s read automatically, reconciled against the statement totals,
            then you review before saving. Uncertain rows are flagged.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept="application/pdf" className="text-sm" />
            <button onClick={runExtract} disabled={pending} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {pending ? "Reading…" : "Read statement"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {ok && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{ok}</p>}

      {rows && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Review — {rows.length} rows</h2>
            <div className="flex gap-2">
              <button onClick={() => { setRows(null); setMeta(null); setError(null); }} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">Cancel</button>
              <button onClick={save} disabled={pending} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {pending ? "Saving…" : `Save ${rows.length}`}
              </button>
            </div>
          </div>

          {/* reconciliation banner */}
          {(spendOff || payOff || lowConf > 0) ? (
            <div className="mt-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
              {spendOff && <div>⚠ Extracted spend {inr(spendSum)} ≠ statement total {inr(meta!.totalSpends!)} — check the rows.</div>}
              {payOff && <div>⚠ Extracted payments {inr(paySum)} ≠ statement total {inr(meta!.totalPayments!)}.</div>}
              {lowConf > 0 && <div>⚠ {lowConf} row(s) flagged low-confidence (highlighted) — verify before saving.</div>}
            </div>
          ) : (
            (meta?.totalSpends != null) && <div className="mt-2 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-700">✓ Reconciled: spend {inr(spendSum)} matches the statement total.</div>
          )}

          <div className="mt-3 max-h-[26rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2">Merchant</th>
                  <th className="py-1 pr-2 text-right">Amount</th>
                  <th className="py-1 pr-2">Type</th>
                  <th className="py-1 pr-2 text-right">Pts</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => {
                  const low = (r.confidence ?? 1) < 0.6;
                  return (
                    <tr key={i} className={low ? "bg-amber-50/60" : ""}>
                      <td className="py-1 pr-2">
                        <input type="date" value={r.date} onChange={(e) => update(i, { date: e.target.value })} className="w-32 rounded border border-slate-200 px-1 py-0.5 text-xs" />
                      </td>
                      <td className="py-1 pr-2">
                        <input value={r.merchant} onChange={(e) => update(i, { merchant: e.target.value })} className="w-full min-w-[8rem] rounded border border-slate-200 px-1 py-0.5" />
                      </td>
                      <td className="py-1 pr-2 text-right">
                        <input type="number" step="0.01" value={r.amount} onChange={(e) => update(i, { amount: Number(e.target.value) })} className="w-24 rounded border border-slate-200 px-1 py-0.5 text-right tabular-nums" />
                      </td>
                      <td className="py-1 pr-2">
                        <select value={r.type} onChange={(e) => update(i, { type: e.target.value as TxnType })} className="rounded border border-slate-200 px-1 py-0.5 text-xs">
                          {TXN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td className="py-1 pr-2 text-right">
                        <input type="number" value={r.rewardPoints ?? ""} onChange={(e) => update(i, { rewardPoints: e.target.value === "" ? null : Number(e.target.value) })} className="w-16 rounded border border-slate-200 px-1 py-0.5 text-right tabular-nums" />
                      </td>
                      <td className="py-1 text-right">
                        <button onClick={() => remove(i)} className="text-slate-300 hover:text-red-600">✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
