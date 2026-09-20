import { formatINR } from "@/lib/format";
import { unpayFamilyCardBill } from "@/app/actions";
import { PayCardBillModal } from "@/components/PayCardBillModal";
import { ToastForm } from "@/components/ToastForm";
import type { CardDue, CardDueItem, BalanceCardView } from "@/lib/personal/cash";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";

// A card's full unpaid bill = your personal dues + any family spends on the card (the bank bills you
// for both; the family reimburses their share separately). This is the number you pay the card.
const fullUnpaid = (d: CardDue) => d.unpaidTotal + d.familyUnpaidTotal;

// The line items behind a cycle total — "view the spends done on this specific card". Family-used
// spends carry a tag so you can see the card was used by the family (still on your bill).
function ItemList({ items }: { items: CardDueItem[] }) {
  if (items.length === 0) return null;
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer text-[11px] font-medium text-emerald-700">View {items.length} spend{items.length === 1 ? "" : "s"}</summary>
      <ul className="mt-1 divide-y divide-slate-100 rounded-lg bg-white px-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-center justify-between gap-2 py-1.5 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 truncate text-slate-600">
              <span className="truncate">{it.label} <span className="text-slate-400">· {fmtDate(it.dateISO)}</span></span>
              {it.family && <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">Family</span>}
            </span>
            <span className="tabular-nums text-slate-700">{formatINR(it.amount)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// One card's dues block: the full bill you owe the card, its cycles, and the line items (incl. family).
// `showPaid` keeps the settled-cycle history (with undo) — on by default only on a card's own page; the
// day-to-day dues strip hides it (a paid bill is done).
function CardBlock({ d, showPaid }: { d: CardDue; showPaid: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
        <span className="text-sm font-semibold text-slate-800">💳 {d.cardName}</span>
        <span className="ml-auto text-sm tabular-nums text-slate-500">
          On card, unpaid <b className="text-slate-800">{formatINR(fullUnpaid(d))}</b>
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
          {d.cycles.map((c) => {
            const cycleFull = c.total + c.familyTotal;
            return (
              <li key={c.cycleEndISO} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-600">
                    {c.generated ? "Bill" : "Accruing"} {fmtDate(c.cycleEndISO)}
                    {c.dueISO ? <> · due {fmtDate(c.dueISO)}</> : null} ·{" "}
                    <b className="tabular-nums text-slate-800">{formatINR(cycleFull)}</b>
                  </span>
                  {c.generated ? (
                    <PayCardBillModal cardId={d.cardId} cardName={d.cardName} color={d.color} cycleEndISO={c.cycleEndISO} dueISO={c.dueISO ?? c.cycleEndISO} familyBudgeted={c.familyBudgeted} familyMisc={Math.round((c.familyTotal - c.familyBudgeted) * 100) / 100} personalAmount={c.total} annualFee={c.annualFee} />
                  ) : (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-400 ring-1 ring-slate-200">
                      bill generates {fmtDate(c.cycleEndISO)}
                    </span>
                  )}
                </div>
                <ItemList items={c.items} />
              </li>
            );
          })}
          {d.cycles.length === 0 && (
            <li className="px-1 py-1 text-xs text-slate-400">All bills settled 🎉</li>
          )}
          {showPaid && d.paid.map((p) => (
            <li key={p.billId} className="rounded-lg px-3 py-1 text-xs text-slate-400">
              <div className="flex items-center justify-between gap-2">
                <span>✓ Paid — bill {fmtDate(p.cycleEndISO)} · {formatINR(p.amount)}</span>
                <ToastForm action={unpayFamilyCardBill} successMessage="Bill payment undone">
                  <input type="hidden" name="cardId" value={d.cardId} />
                  <input type="hidden" name="cycleEnd" value={p.cycleEndISO} />
                  <button className="font-medium text-slate-400 hover:text-red-600">undo</button>
                </ToastForm>
              </div>
              <ItemList items={p.items} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// One debit/prepaid card block: its current balance + the spends drawn from it (incl. family, tagged).
function BalanceBlock({ b }: { b: BalanceCardView }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />
        <span className="text-sm font-semibold text-slate-800">💳 {b.cardName}</span>
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{b.prepaid ? "prepaid" : "debit"}</span>
        <span className="ml-auto text-sm tabular-nums text-slate-500">
          Balance <b className={b.balance < 0 ? "text-red-600" : "text-emerald-700"}>{formatINR(b.balance)}</b>
        </span>
      </div>
      <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
        {b.spends.length === 0
          ? <p className="text-xs text-slate-400">No spends on this card yet.</p>
          : <ItemList items={b.spends} />}
      </div>
    </div>
  );
}

// All of the member's cards in one place: credit cards show the full unpaid bill + cycles; debit/prepaid
// show their balance + spends. Both list family-used spends with a tag. "Mark bill paid" settles a credit
// cycle. Collapsible (seamless) — the summary always lists every card even when collapsed.
export function CardDuesStrip({ dues, balances = [], showPaid = false }: { dues: CardDue[]; balances?: BalanceCardView[]; showPaid?: boolean }) {
  const active = dues.filter((d) => fullUnpaid(d) > 0 || (showPaid && d.paid.length > 0));
  const count = active.length + balances.length;
  if (count === 0) return null;
  const grandTotal = active.reduce((s, d) => s + fullUnpaid(d), 0); // "to pay" = credit bills only (balance cards owe nothing)

  return (
    <details className="group rounded-xl border border-slate-200 bg-slate-50/60">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 p-3 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold text-slate-800">💳 Cards</span>
        <span className="text-xs text-slate-500">· {count} card{count === 1 ? "" : "s"}</span>
        {grandTotal > 0 && (
          <span className="ml-auto text-sm tabular-nums text-slate-500">
            to pay <b className="text-slate-800">{formatINR(grandTotal)}</b>
          </span>
        )}
        <svg width="16" height="16" viewBox="0 0 20 20" className={`shrink-0 text-slate-400 transition-transform group-open:rotate-90 ${grandTotal > 0 ? "" : "ml-auto"}`} aria-hidden>
          <path fill="currentColor" d="M7 5l6 5-6 5z" />
        </svg>
        {/* collapsed glance: every card — credit shows its full bill, balance cards show their balance */}
        <span className="w-full group-open:hidden">
          <span className="mt-1 flex flex-wrap gap-1.5">
            {active.map((d) => (
              <span key={`d-${d.cardId}`} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600">
                <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                {d.cardName} <b className="tabular-nums text-slate-800">{formatINR(fullUnpaid(d))}</b>
              </span>
            ))}
            {balances.map((b) => (
              <span key={`b-${b.cardId}`} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600">
                <span className="h-2 w-2 rounded-full" style={{ background: b.color }} />
                {b.cardName} <b className="tabular-nums text-emerald-700">{formatINR(b.balance)}</b>
              </span>
            ))}
          </span>
        </span>
      </summary>
      <div className="space-y-2 p-3 pt-0">
        {active.map((d) => <CardBlock key={`d-${d.cardId}`} d={d} showPaid={showPaid} />)}
        {balances.map((b) => <BalanceBlock key={`b-${b.cardId}`} b={b} />)}
      </div>
    </details>
  );
}
