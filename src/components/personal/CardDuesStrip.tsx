import { formatINR } from "@/lib/format";
import { markCardBillPaid, unmarkCardBillPaid } from "@/app/personal/actions";
import type { CardDue } from "@/lib/personal/cash";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";

// Per credit card: the CC-tagged spends that haven't left your cash yet, grouped into
// billing cycles. "Mark bill paid" posts the one real cash deduction (this month) and
// settles that cycle; undo reverses it.
export function CardDuesStrip({ dues }: { dues: CardDue[] }) {
  const active = dues.filter((d) => d.unpaidTotal > 0 || d.paid.length > 0);
  if (active.length === 0) return null;
  return (
    <section className="space-y-2">
      {active.map((d) => (
        <div key={d.cardId} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
            <span className="text-sm font-semibold text-slate-800">💳 {d.cardName}</span>
            <span className="ml-auto text-sm tabular-nums text-slate-500">
              On card, unpaid <b className="text-slate-800">{formatINR(d.unpaidTotal)}</b>
            </span>
          </div>

          {d.needsStatementDay ? (
            <p className="mt-2 text-xs text-amber-600">
              Set a <b>statement day</b> on this card (Finance → open the card) to track its bill cycle &amp; due date.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {d.cycles.map((c) => (
                <li key={c.cycleEndISO} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-600">
                    Bill {fmtDate(c.cycleEndISO)}
                    {c.dueISO ? <> · due {fmtDate(c.dueISO)}</> : null} ·{" "}
                    <b className="tabular-nums text-slate-800">{formatINR(c.total)}</b>
                  </span>
                  <form action={markCardBillPaid}>
                    <input type="hidden" name="cardAccountId" value={d.cardId} />
                    <input type="hidden" name="cycleEnd" value={c.cycleEndISO} />
                    <input type="hidden" name="amount" value={c.total} />
                    <button className="whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white active:bg-emerald-700">
                      Mark bill paid
                    </button>
                  </form>
                </li>
              ))}
              {d.cycles.length === 0 && (
                <li className="px-1 py-1 text-xs text-slate-400">All bills settled 🎉</li>
              )}
              {d.paid.map((p) => (
                <li key={p.billId} className="flex items-center justify-between gap-2 px-3 py-1 text-xs text-slate-400">
                  <span>✓ Paid — bill {fmtDate(p.cycleEndISO)} · {formatINR(p.amount)}</span>
                  <form action={unmarkCardBillPaid}>
                    <input type="hidden" name="id" value={p.billId} />
                    <button className="font-medium text-slate-400 hover:text-red-600">undo</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
