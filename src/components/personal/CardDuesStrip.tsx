import { formatINR } from "@/lib/format";
import { unmarkCardBillPaid } from "@/app/personal/actions";
import { MarkBillPaidButton } from "@/components/personal/MarkBillPaidButton";
import type { CardDue, CardDueItem } from "@/lib/personal/cash";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";

// The line items behind a cycle total — "view the spends done on this specific card".
function ItemList({ items }: { items: CardDueItem[] }) {
  if (items.length === 0) return null;
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer text-[11px] font-medium text-emerald-700">View {items.length} spend{items.length === 1 ? "" : "s"}</summary>
      <ul className="mt-1 divide-y divide-slate-100 rounded-lg bg-white px-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-center justify-between gap-2 py-1.5 text-xs">
            <span className="min-w-0 truncate text-slate-600">
              {it.label} <span className="text-slate-400">· {fmtDate(it.dateISO)}</span>
            </span>
            <span className="tabular-nums text-slate-700">{formatINR(it.amount)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// Per credit card: the CC-tagged spends that haven't left your cash yet, grouped into
// billing cycles. "Mark bill paid" posts the one real cash deduction (this month, with the
// exact amount you paid) and settles that cycle; undo reverses it. Each cycle expands to
// show its individual spends.
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
            <>
              <p className="mt-2 text-xs text-amber-600">
                Set a <b>statement day</b> on this card (Finance → open the card) to track its bill cycle &amp; due date.
              </p>
              <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
                <ItemList items={d.ungrouped} />
              </div>
            </>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {d.cycles.map((c) => (
                <li key={c.cycleEndISO} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-slate-600">
                      Bill {fmtDate(c.cycleEndISO)}
                      {c.dueISO ? <> · due {fmtDate(c.dueISO)}</> : null} ·{" "}
                      <b className="tabular-nums text-slate-800">{formatINR(c.total)}</b>
                    </span>
                    <MarkBillPaidButton cardId={d.cardId} cardName={d.cardName} cycleEndISO={c.cycleEndISO} cycleTotal={c.total} />
                  </div>
                  <ItemList items={c.items} />
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
