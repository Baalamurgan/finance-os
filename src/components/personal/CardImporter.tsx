"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { extractStatement, savePersonalCardTxns, type ExtractedTxn } from "@/app/personal/cc/actions";

type Card = { id: number; name: string };

export function CardImporter({ cards }: { cards: Card[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [cardId, setCardId] = useState(cards[0]?.id ?? 0);
  const [rows, setRows] = useState<ExtractedTxn[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (cards.length === 0) {
    return <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Add a card first, then import a statement.</p>;
  }

  const runExtract = () => {
    setError(null);
    setOk(null);
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose a PDF statement first.");
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const res = await extractStatement(fd);
      if (res.ok) setRows(res.transactions);
      else setError(res.error);
    });
  };

  const update = (i: number, patch: Partial<ExtractedTxn>) =>
    setRows((rs) => (rs ? rs.map((r, j) => (j === i ? { ...r, ...patch } : r)) : rs));
  const remove = (i: number) => setRows((rs) => (rs ? rs.filter((_, j) => j !== i) : rs));

  const save = () => {
    if (!rows || rows.length === 0) return;
    const fd = new FormData();
    fd.set("cardId", String(cardId));
    fd.set("rows", JSON.stringify(rows));
    start(async () => {
      const res = await savePersonalCardTxns(fd);
      if (res.ok) {
        setOk(`Imported ${res.n} transactions.`);
        setRows(null);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } else setError(res.error ?? "Save failed.");
    });
  };

  const total = rows ? rows.filter((r) => r.type === "spend").reduce((s, r) => s + (Number(r.amount) || 0), 0) : 0;

  return (
    <div className="space-y-3">
      {!rows && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Import a statement (PDF)</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Upload your monthly PDF — the transactions are read automatically, then you review before saving.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">
              Card
              <select value={cardId} onChange={(e) => setCardId(Number(e.target.value))} className="input mt-0.5 block">
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <input ref={fileRef} type="file" accept="application/pdf" className="text-sm" />
            <button
              onClick={runExtract}
              disabled={pending}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
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
            <h2 className="text-sm font-semibold text-slate-900">Review — {rows.length} rows · spend ₹{Math.round(total).toLocaleString("en-IN")}</h2>
            <div className="flex gap-2">
              <button onClick={() => { setRows(null); setError(null); }} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">Cancel</button>
              <button onClick={save} disabled={pending} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {pending ? "Saving…" : `Save ${rows.length}`}
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-400">Fix anything that looks off, or ✕ a row to drop it.</p>
          <div className="mt-3 max-h-[26rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2">Merchant</th>
                  <th className="py-1 pr-2 text-right">Amount</th>
                  <th className="py-1 pr-2">Type</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={i}>
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
                      <select value={r.type} onChange={(e) => update(i, { type: e.target.value as ExtractedTxn["type"] })} className="rounded border border-slate-200 px-1 py-0.5 text-xs">
                        <option value="spend">spend</option>
                        <option value="payment">payment</option>
                        <option value="refund">refund</option>
                      </select>
                    </td>
                    <td className="py-1 text-right">
                      <button onClick={() => remove(i)} className="text-slate-300 hover:text-red-600">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
