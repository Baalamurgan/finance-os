"use client";

import { useState } from "react";
import { formatINR } from "@/lib/format";
import type { MemberLedger, LedgerRow, LedgerTag } from "@/lib/queries";

const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
// IST date + time of when it really happened ("1 Nov" / "8:33 pm").
const istDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
const istTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).toLowerCase();

const TAG_STYLE: Record<LedgerTag["kind"], string> = {
  card: "bg-indigo-50 text-indigo-700",
  bank: "bg-sky-50 text-sky-700",
  cat: "bg-slate-100 text-slate-600",
  oop: "bg-amber-100 text-amber-800",
  piggy: "bg-pink-50 text-pink-600",
};

// Money-in / money-out ledger for one month, per member, in the order things REALLY happened (paid /
// ticked / logged time). The running balance starts at ₹0 and ends exactly at that member's In-Hand (same
// walk the In-Hand card uses). Boundary rows (carried balance, Piggy held) sit on top. Credit-card spends
// are listed greyed with "—" running: no cash left yet (it goes when the card bill is paid).
export function Transactions({
  ledgers,
  defaultMemberId,
}: {
  ledgers: MemberLedger[];
  defaultMemberId?: number | null;
}) {
  const [sel, setSel] = useState<number | null>(
    defaultMemberId != null && ledgers.some((l) => l.memberId === defaultMemberId)
      ? defaultMemberId
      : ledgers[0]?.memberId ?? null,
  );
  const m = ledgers.find((l) => l.memberId === sel) ?? ledgers[0];
  if (!m) return <p className="p-8 text-center text-sm text-slate-500">No members yet.</p>;

  const When = ({ r }: { r: LedgerRow }) => {
    if (r.boundary) return <>Carried</>;
    if (!r.atISO) return <>—</>;
    return (
      <>
        <div>{istDate(r.atISO)}</div>
        <div className="text-[10px] text-slate-300">{istTime(r.atISO)}</div>
        {r.plannedDay != null && <div className="text-[10px] text-slate-300">planned {ord(r.plannedDay)}</div>}
      </>
    );
  };
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
              const onCard = r.dir === "card";
              return (
                <tr key={i} className={`fo-reveal border-b border-slate-100 align-top ${r.boundary ? "bg-slate-50/70" : onCard ? "bg-slate-50/40" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-400"><When r={r} /></td>
                  <td className={`px-3 py-2 ${onCard ? "text-slate-400" : "text-slate-700"}`}>
                    <div>{r.label}</div>
                    {(r.tags.length > 0 || onCard) && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {r.tags.map((t, j) => (
                          <span key={j} className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium ${TAG_STYLE[t.kind]}`}>
                            {t.color && (t.kind === "card" || t.kind === "bank") && <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />}
                            {t.text}
                          </span>
                        ))}
                        {onCard && <span className="rounded-full px-1.5 py-px text-[10px] text-slate-400 ring-1 ring-slate-200">on card · not cash yet</span>}
                      </div>
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums ${
                      onCard ? "text-slate-400" : r.dir === "in" ? "text-emerald-700" : "text-rose-600"
                    }`}
                  >
                    {onCard ? "" : r.dir === "in" ? "+" : "−"}
                    {formatINR(r.amount)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                      r.running == null ? "text-slate-300" : r.running < 0 ? "text-rose-500" : "text-slate-500"
                    }`}
                  >
                    {r.running == null ? "—" : signed(r.running)}
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
        Green = money in · red = money out · grey 💳 = on a credit card (no cash yet — it leaves when the card bill is paid, so it isn&apos;t in the running total). In the order it really happened; &quot;planned&quot; shows the plan&apos;s day when that differs. Running balance starts at ₹0 and ends at the in-hand above.
      </p>
    </div>
  );
}
