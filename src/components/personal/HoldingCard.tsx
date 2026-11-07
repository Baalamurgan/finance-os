"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { setHoldingValue, addHoldingMoney, deleteHoldingEntry, deleteNetWorthItem, type ItemFormState } from "@/app/personal/finance/actions";
import { NetWorthItemModal } from "@/components/personal/NetWorthItemModal";
import { ConfirmForm } from "@/components/ConfirmForm";
import { useToast } from "@/components/Toast";
import { formatINR } from "@/lib/format";
import { netWorthTypeMeta } from "@/lib/finance/types";
import type { Holding } from "@/lib/finance/networth";

const INIT: ItemFormState = { ok: false, n: 0 };
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const today = () => new Date().toISOString().slice(0, 10);
const KIND_LABEL: Record<string, string> = { opening: "Invested before tracking", contribution: "Added", withdrawal: "Taken out", value: "Value set to" };

// One holding: what it's worth, what went in, the gain, FD maturity, the Setup items feeding it every month,
// and its dated history. Actions: update value · add money · take out · edit · remove.
export function HoldingCard({ h }: { h: Holding }) {
  const meta = netWorthTypeMeta(h.type);
  const [panel, setPanel] = useState<null | "value" | "add" | "withdraw">(null);
  const [showHistory, setShowHistory] = useState(false);
  const gainUp = h.gain >= 0;

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span aria-hidden>{meta.icon}</span>
            <span className="truncate font-semibold text-slate-800">{h.name}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {meta.label}{h.institution ? ` · ${h.institution}` : ""}{h.quantity != null ? ` · ${h.quantity} units` : ""}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-bold tabular-nums text-slate-900">{formatINR(h.value)}</div>
          {h.invested > 0 && (
            <div className={`text-[11px] font-medium tabular-nums ${gainUp ? "text-emerald-700" : "text-rose-600"}`}>
              {gainUp ? "▲" : "▼"} {formatINR(Math.abs(h.gain))}{h.gainPct != null ? ` (${Math.abs(h.gainPct).toFixed(1)}%)` : ""}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        {h.invested > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Invested {formatINR(h.invested)}</span>}
        {h.valueAsOf && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">value as of {fmtDate(h.valueAsOf)}</span>}
        {h.startDate && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">since {fmtDate(h.startDate)}</span>}
        {h.maturity && (
          <span className={`rounded-full px-2 py-0.5 font-medium ${h.maturity.daysLeft <= 30 ? "bg-amber-100 text-amber-800" : "bg-sky-50 text-sky-700"}`}>
            {h.interestRate}% · matures {fmtDate(h.maturity.date)} → {formatINR(h.maturity.value)}
            {h.maturity.daysLeft >= 0 ? ` · ${h.maturity.daysLeft}d left` : " · matured"}
          </span>
        )}
        {h.linked.map((l) => <span key={l} className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700" title="Added automatically each time you tick it in your Money Plan">🔁 {l}</span>)}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setPanel(panel === "value" ? null : "value")} className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700">Update value</button>
        <button type="button" onClick={() => setPanel(panel === "add" ? null : "add")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">+ Add money</button>
        <button type="button" onClick={() => setPanel(panel === "withdraw" ? null : "withdraw")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">− Take out</button>
        <span className="ml-auto flex items-center gap-2">
          <NetWorthItemModal category="asset" initial={{ id: h.id, type: h.type, name: h.name, value: h.value, quantity: h.quantity, institution: h.institution, notes: h.notes, startDate: h.startDate, tenureMonths: h.tenureMonths, interestRate: h.interestRate }} trigger="pencil" />
          <ConfirmForm action={deleteNetWorthItem} message={`Remove ${h.name} and its history?`}>
            <input type="hidden" name="id" value={h.id} />
            <button type="submit" aria-label="Remove" className="text-slate-300 hover:text-red-600">✕</button>
          </ConfirmForm>
        </span>
      </div>

      {panel && <MoneyPanel key={panel} h={h} mode={panel} onDone={() => setPanel(null)} />}

      {h.entries.length > 0 && (
        <div className="mt-2.5 border-t border-slate-100 pt-2">
          <button type="button" onClick={() => setShowHistory(!showHistory)} className="text-[11px] font-medium text-slate-500 hover:text-slate-800">
            {showHistory ? "▾" : "▸"} History ({h.entries.length})
          </button>
          {showHistory && (
            <ul className="mt-1.5 space-y-1">
              {h.entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="min-w-0 text-slate-600">
                    <span className="tabular-nums text-slate-400">{fmtDate(e.date)}</span> · {KIND_LABEL[e.kind] ?? e.kind}
                    {e.note ? <span className="text-slate-400"> · {e.note}</span> : null}
                    {e.auto && <span className="ml-1 rounded bg-emerald-50 px-1 text-[10px] text-emerald-700" title="From your Money Plan / Spends — untick it there to undo">auto</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`tabular-nums font-medium ${e.kind === "withdrawal" ? "text-rose-600" : e.kind === "value" ? "text-slate-700" : "text-emerald-700"}`}>
                      {e.kind === "withdrawal" ? "−" : e.kind === "value" ? "" : "+"}{formatINR(e.amount)}
                    </span>
                    {!e.auto && (
                      <ConfirmForm action={deleteHoldingEntry} message="Remove this history entry?">
                        <input type="hidden" name="id" value={e.id} />
                        <button type="submit" aria-label="Remove entry" className="text-slate-300 hover:text-red-600">✕</button>
                      </ConfirmForm>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function MoneyPanel({ h, mode, onDone }: { h: Holding; mode: "value" | "add" | "withdraw"; onDone: () => void }) {
  const toast = useToast();
  const prevN = useRef(0);
  const [state, action, pending] = useActionState(mode === "value" ? setHoldingValue : addHoldingMoney, INIT);
  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      if (state.ok) { toast(mode === "value" ? "Value updated" : mode === "add" ? "Added" : "Taken out", "success"); onDone(); }
      else toast(state.error ?? "Couldn't save", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);
  return (
    <form action={action} className="mt-2.5 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2.5">
      <input type="hidden" name="id" value={h.id} />
      {mode !== "value" && <input type="hidden" name="kind" value={mode === "add" ? "contribution" : "withdrawal"} />}
      <label className="flex-1">
        <span className="text-[11px] font-medium text-slate-500">{mode === "value" ? "Worth today (₹)" : mode === "add" ? "Amount added (₹)" : "Amount taken out (₹)"}</span>
        <input name={mode === "value" ? "value" : "amount"} inputMode="decimal" required autoFocus defaultValue={mode === "value" ? h.value : ""} className="input mt-0.5 w-full py-1.5 text-sm" />
      </label>
      {mode !== "value" && (
        <label>
          <span className="text-[11px] font-medium text-slate-500">On</span>
          <input name="date" type="date" defaultValue={today()} className="input mt-0.5 w-36 py-1.5 text-sm" />
        </label>
      )}
      <label className="w-full sm:w-auto sm:flex-1">
        <span className="text-[11px] font-medium text-slate-500">Note (optional)</span>
        <input name="note" placeholder={mode === "value" ? "e.g. checked Groww" : "e.g. lump sum"} className="input mt-0.5 w-full py-1.5 text-sm" />
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={onDone} className="rounded-md px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-100">Cancel</button>
        <button type="submit" disabled={pending} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">{pending ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}
