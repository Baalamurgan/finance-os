"use client";

import { useState } from "react";
import { formatINR } from "@/lib/format";
import type { MemberLedger } from "@/lib/queries";

// Date-sorted money-in / money-out ledger for one month, per member. The running balance starts at ₹0,
// adds each transaction in date order, and ends exactly at that member's In-Hand (same walk the In-Hand
// card uses). Boundary rows (carried balance, last month's Piggy sweep, Piggy held) sort to the top.
export function Transactions({
  ledgers,
  monthLabel,
  defaultMemberId,
}: {
  ledgers: MemberLedger[];
  monthLabel: string;
  defaultMemberId?: number | null;
}) {
  const [sel, setSel] = useState<number | null>(
    defaultMemberId != null && ledgers.some((l) => l.memberId === defaultMemberId)
      ? defaultMemberId
      : ledgers[0]?.memberId ?? null,
  );
  const m = ledgers.find((l) => l.memberId === sel) ?? ledgers[0];
  if (!m) return <p className="p-8 text-center text-sm text-slate-500">No members yet.</p>;

  const when = (day: number | null) => (day === -1 ? "Carried" : day == null ? "—" : `${day} ${monthLabel}`);
  const signed = (n: number) => (n < 0 ? "−" : "") + formatINR(Math.abs(n));

  return (
    <div className="space-y-3">
      {/* member selector */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {ledgers.map((l) => {
          const active = l.memberId === m.memberId;
          return (
            <button
              key={l.memberId}
              onClick={() => setSel(l.memberId)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                active ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {l.name}
            </button>
          );
        })}
      </div>

      {/* running-total headline */}
      <div className="flex items-baseline justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
        <span className="text-sm font-semibold text-slate-800">
          {m.name} <span className="font-normal text-slate-400">· in hand now</span>
        </span>
        <span className={`text-lg font-bold tabular-nums ${m.inHand < 0 ? "text-rose-600" : "text-emerald-700"}`}>
          {signed(m.inHand)}
        </span>
      </div>

      {/* ledger */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Transaction</th>
              <th className="px-3 py-2 text-right font-medium">₹</th>
              <th className="px-3 py-2 text-right font-medium">Running</th>
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r, i) => {
              const boundary = r.day === -1;
              return (
                <tr key={i} className={`border-b border-slate-100 ${boundary ? "bg-slate-50/70" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-400">{when(r.day)}</td>
                  <td className="px-3 py-2 text-slate-700">{r.label}</td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums ${
                      r.dir === "in" ? "text-emerald-700" : "text-rose-600"
                    }`}
                  >
                    {r.dir === "in" ? "+" : "−"}
                    {formatINR(r.amount)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                      r.running < 0 ? "text-rose-500" : "text-slate-500"
                    }`}
                  >
                    {signed(r.running)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-semibold text-slate-800">
              <td className="px-3 py-2" colSpan={3}>
                = In hand now
              </td>
              <td
                className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                  m.inHand < 0 ? "text-rose-600" : "text-emerald-700"
                }`}
              >
                {signed(m.inHand)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="px-1 text-[11px] text-slate-400">
        Green = money in · red = money out. Running balance starts at ₹0 and ends at the in-hand above.
      </p>
    </div>
  );
}
