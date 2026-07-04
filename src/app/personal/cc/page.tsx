import { formatINR } from "@/lib/format";
import { loadPersonal } from "@/lib/loadPersonal";
import { getCardDashboard } from "@/lib/ccAnalysis";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { CardImporter } from "@/components/personal/CardImporter";
import { SpendBars } from "@/components/Charts";
import { ConfirmForm } from "@/components/ConfirmForm";
import { addPersonalCard, deletePersonalCard, deletePersonalCardTxn } from "@/app/personal/cc/actions";

export default async function PersonalCC({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const d = await getCardDashboard(c.member.id);

  return (
    <>
      <PersonalNav active="cc" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} />
      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Cards</h1>
          <p className="text-sm text-slate-500">Your credit-card spending — imported from statements.</p>
        </div>

        {/* headline stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="All-time spent" value={formatINR(d.allTime)} big />
          <Stat label="Avg / month" value={formatINR(Math.round(d.avgMonthly))} sub={`over ${d.monthsActive} mo`} />
          <Stat label="Transactions" value={String(d.txnCount)} />
          <Stat label="Cards" value={String(d.cards.length)} />
        </div>

        {/* monthly bar chart */}
        {d.monthly.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Monthly card spend</h2>
            <SpendBars data={d.monthly} />
          </div>
        )}

        {/* cards + add */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Your cards</h2>
          <div className="mt-3 space-y-2">
            {d.cards.length === 0 ? (
              <p className="text-sm text-slate-400">No cards yet — add one below.</p>
            ) : (
              d.cards.map((card) => (
                <div key={card.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 p-3">
                  <div className="flex items-center gap-3">
                    <span className="h-8 w-8 shrink-0 rounded-md" style={{ background: card.color }} />
                    <div>
                      <div className="text-sm font-medium text-slate-800">{card.name}</div>
                      <div className="text-xs text-slate-400">
                        {[card.bank, card.last4 ? `••${card.last4}` : null].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-sm font-semibold text-slate-700">{formatINR(card.total)}</span>
                    <ConfirmForm action={deletePersonalCard} message={`Delete ${card.name} and all its transactions?`}>
                      <input type="hidden" name="id" value={card.id} />
                      <button className="text-xs text-slate-300 hover:text-red-600">Delete</button>
                    </ConfirmForm>
                  </div>
                </div>
              ))
            )}
          </div>
          <details className="mt-3 border-t border-slate-100 pt-3">
            <summary className="cursor-pointer text-xs font-medium text-indigo-700">+ Add a card</summary>
            <form action={addPersonalCard} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <input name="name" placeholder="Card name" required className="input col-span-2" />
              <input name="bank" placeholder="Bank" className="input" />
              <input name="last4" placeholder="Last 4" maxLength={4} className="input" />
              <input name="limitAmt" type="number" placeholder="Limit ₹" className="input" />
              <input name="color" type="color" defaultValue="#6366f1" className="h-9 w-full rounded border border-slate-200" />
              <button className="col-span-2 rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white sm:col-span-1">Add card</button>
            </form>
          </details>
        </section>

        {/* import */}
        <CardImporter cards={d.cards.map((c) => ({ id: c.id, name: c.name }))} />

        {/* top merchants */}
        {d.topMerchants.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Top merchants</h2>
            <ul className="space-y-2">
              {d.topMerchants.map((m) => (
                <li key={m.merchant} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate text-slate-600">{m.merchant}</span>
                  <span className="text-xs text-slate-400">×{m.count}</span>
                  <span className="w-24 text-right tabular-nums font-medium text-slate-800">{formatINR(m.total)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* recent transactions */}
        {d.recent.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Recent transactions</h2>
            <ul className="divide-y divide-slate-100">
              {d.recent.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate text-slate-700">{t.merchant}</div>
                    <div className="text-xs text-slate-400">
                      {t.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })} · {t.cardName}
                      {t.type !== "spend" ? ` · ${t.type}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`tabular-nums font-medium ${t.type === "spend" ? "text-slate-800" : "text-emerald-600"}`}>
                      {t.type === "spend" ? "" : "+"}{formatINR(t.amount)}
                    </span>
                    <ConfirmForm action={deletePersonalCardTxn} message="Remove this transaction?">
                      <input type="hidden" name="id" value={t.id} />
                      <button className="text-xs text-slate-300 hover:text-red-600">✕</button>
                    </ConfirmForm>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!d.hasData && d.cards.length > 0 && (
          <p className="text-center text-xs text-slate-400">Import a statement above to see your spending come to life.</p>
        )}
      </main>
    </>
  );
}

function Stat({ label, value, sub, big }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 font-bold text-slate-800 ${big ? "text-xl" : "text-lg"}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}
