"use client";

import { useMemo, useState } from "react";
import { formatINR } from "@/lib/format";

export type SplitPerson = { name: string; amount: number };
type Method = "equal" | "shares" | "exact";
type Row = { id: number; name: string; isYou: boolean; count: number; exact: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

// GPay-style splitter, shown on top of the Add-spend modal. You (the payer) are always a
// participant; only the OTHERS' shares become receivables. Methods: Equal, Shares (2×…),
// Exact. Returns the others' shares + your own share (which must all add up to the total).
export function PersonalSplitModal({
  total,
  initial,
  onConfirm,
  onClose,
}: {
  total: number;
  initial?: SplitPerson[];
  onConfirm: (others: SplitPerson[], myShare: number) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<Method>("equal");
  const [rows, setRows] = useState<Row[]>(() => {
    const you: Row = { id: 0, name: "You", isYou: true, count: 1, exact: "" };
    const seed: SplitPerson[] = initial && initial.length > 0 ? initial : [{ name: "", amount: 0 }];
    const others: Row[] = seed.map((p, i) => ({
      id: i + 1, name: p.name ?? "", isYou: false, count: 1, exact: p.amount ? String(p.amount) : "",
    }));
    return [you, ...others];
  });
  const [nextId, setNextId] = useState(rows.length);

  // Computed share for each row given the method (You absorbs any rounding for equal/shares).
  const shares = useMemo(() => {
    const n = rows.length;
    if (n === 0) return [];
    if (method === "exact") return rows.map((r) => r2(Number(r.exact) || 0));
    let raw: number[];
    if (method === "shares") {
      const totalCount = rows.reduce((s, r) => s + (r.count || 0), 0) || 1;
      raw = rows.map((r) => r2((total * (r.count || 0)) / totalCount));
    } else {
      raw = rows.map(() => r2(total / n));
    }
    // make it sum exactly to total by adjusting You's share
    const youIdx = rows.findIndex((r) => r.isYou);
    const othersSum = raw.reduce((s, v, i) => (i === youIdx ? s : s + v), 0);
    if (youIdx >= 0) raw[youIdx] = r2(total - othersSum);
    return raw;
  }, [rows, method, total]);

  const assigned = r2(shares.reduce((s, v) => s + v, 0));
  const others = rows.map((r, i) => ({ row: r, amount: shares[i] })).filter((x) => !x.row.isYou);
  const myShare = shares[rows.findIndex((r) => r.isYou)] ?? 0;
  const namesOk = others.every((o) => o.row.name.trim().length > 0);
  const sumsOk = Math.abs(assigned - total) < 0.01;
  const sharesPositive = others.every((o) => o.amount > 0) && myShare >= 0;
  const canSave = total > 0 && others.length > 0 && namesOk && sumsOk && sharesPositive;

  const setRow = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addPerson = () => { setRows((rs) => [...rs, { id: nextId, name: "", isYou: false, count: 1, exact: "" }]); setNextId((i) => i + 1); };
  const removePerson = (id: number) => setRows((rs) => rs.filter((r) => r.id !== id));

  const confirm = () => {
    if (!canSave) return;
    onConfirm(others.map((o) => ({ name: o.row.name.trim(), amount: o.amount })), myShare);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-bold text-slate-900">Split {formatINR(total)}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 text-slate-400 hover:bg-slate-100">✕</button>
        </div>

        {/* method toggle */}
        <div className="flex gap-1 px-5 pt-3">
          {([["equal", "Equal"], ["shares", "Shares"], ["exact", "Exact"]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setMethod(k)} aria-pressed={method === k}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${method === k ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="px-5 pt-1.5 text-[11px] text-slate-400">
          {method === "equal" ? "Split evenly across everyone." : method === "shares" ? "Give someone more with a share count (e.g. 2×)." : "Type each person's exact amount — must add up to the total."}
        </p>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-3">
          {rows.map((r, i) => (
            <div key={r.id} className="flex items-center gap-2">
              {r.isYou ? (
                <span className="flex-1 rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">You</span>
              ) : (
                <input value={r.name} onChange={(e) => setRow(r.id, { name: e.target.value })} placeholder="Name *" className="input flex-1 py-2" />
              )}
              {method === "shares" && (
                <div className="flex items-center rounded-lg border border-slate-200">
                  <button type="button" onClick={() => setRow(r.id, { count: Math.max(1, r.count - 1) })} className="px-2 py-1.5 text-slate-500">−</button>
                  <span className="w-6 text-center text-sm tabular-nums">{r.count}×</span>
                  <button type="button" onClick={() => setRow(r.id, { count: r.count + 1 })} className="px-2 py-1.5 text-slate-500">+</button>
                </div>
              )}
              {method === "exact" ? (
                <input value={r.exact} onChange={(e) => setRow(r.id, { exact: e.target.value })} type="number" step="0.01" inputMode="decimal" placeholder="₹" className="input w-24 py-2 text-right" />
              ) : (
                <span className="w-24 text-right text-sm font-semibold tabular-nums text-slate-700">{formatINR(shares[i] ?? 0)}</span>
              )}
              {!r.isYou && (
                <button type="button" onClick={() => removePerson(r.id)} aria-label="Remove" className="text-slate-300 hover:text-red-600">✕</button>
              )}
            </div>
          ))}
          <button type="button" onClick={addPerson} className="mt-1 w-full rounded-lg border border-dashed border-emerald-300 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
            + Add person
          </button>
        </div>

        <div className="border-t border-slate-100 px-5 py-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-slate-500">Assigned</span>
            <span className={`font-semibold tabular-nums ${sumsOk ? "text-slate-800" : "text-red-600"}`}>
              {formatINR(assigned)} <span className="text-xs font-normal text-slate-400">of {formatINR(total)}</span>
            </span>
          </div>
          {!sumsOk && method === "exact" && <p className="mb-2 text-[11px] text-red-600">Amounts must add up to {formatINR(total)}.</p>}
          <div className="mb-2 text-[11px] text-slate-400">Your share {formatINR(myShare)} · others owe {formatINR(r2(total - myShare))}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border-2 border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600">Cancel</button>
            <button type="button" onClick={confirm} disabled={!canSave} className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}
