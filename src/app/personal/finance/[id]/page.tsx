import Link from "next/link";
import { redirect } from "next/navigation";
import { formatINR, pctLabel } from "@/lib/format";
import { loadPersonal } from "@/lib/loadPersonal";
import { getAccountDetail } from "@/lib/finance/queries";
import { getCardDues } from "@/lib/personal/cash";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { CardDuesStrip } from "@/components/personal/CardDuesStrip";
import { ConfirmForm } from "@/components/ConfirmForm";
import { setCreditConfig, deleteTransaction, addManualTransaction } from "@/app/personal/finance/actions";
import { TXN_TYPES } from "@/lib/finance/types";

const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default async function CreditCardDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const detail = await getAccountDetail(c.member.id, Number(id));
  if (!detail || detail.account.type !== "credit_card") redirect("/personal/finance");

  const { account, txns, dashboard: d } = detail;
  const cfg = account.credit;
  // The in-app spends/fixed lines tagged to THIS card that are still deferred from cash
  // (grouped into bill cycles), so you can view exactly what's riding on this card.
  const dues = (await getCardDues(c.member.id)).filter((due) => due.cardId === account.id);

  return (
    <>
      <PersonalNav active="finance" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} financeDue={c.cardReminders.length > 0} />
      <main className="mx-auto max-w-3xl space-y-5 p-4 pb-24 sm:p-6">
        <div>
          <Link href="/personal/finance" className="text-xs font-medium text-emerald-700 hover:underline">← All cards</Link>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-3.5 w-3.5 rounded-full" style={{ background: account.color }} />
            <h1 className="text-xl font-bold text-slate-900">{account.name}</h1>
          </div>
          <p className="text-xs text-slate-400">
            {[account.institution, account.network?.toUpperCase(), account.last4 && `•• ${account.last4}`].filter(Boolean).join(" · ") || "credit card"}
          </p>
        </div>

        {/* headline: outstanding / available / utilisation */}
        {d.hasLimit ? (
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Outstanding" value={formatINR(d.outstanding)} big />
            <Stat label="Available" value={formatINR(Math.max(0, d.available ?? 0))} />
            <Stat label="Utilisation" value={pctLabel(d.utilPct ?? 0)} danger={(d.utilPct ?? 0) >= 30} />
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Set a <b>credit limit</b> below to see utilisation, available credit and dues.
          </div>
        )}

        {/* current billing cycle */}
        {d.cycle ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">Current billing cycle</h2>
            <p className="mt-0.5 text-xs text-slate-500">{fmtDate(d.cycle.start)} → {fmtDate(d.cycle.end)}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Mini label="Statement date" value={fmtDate(d.cycle.statementDate)} />
              <Mini label="Payment due" value={fmtDate(d.cycle.dueDate)} />
              <Mini label="Spent this cycle" value={formatINR(d.spentThisCycle)} />
              <Mini label="Payments this cycle" value={formatINR(d.paymentsThisCycle)} />
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Set a <b>statement day</b> below to track billing cycles, statement &amp; due dates.
          </div>
        )}

        {/* in-app spends tagged to this card, deferred from cash (view + pay the bill) */}
        {dues.length > 0 && (
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-800">On this card, unpaid</h2>
            <CardDuesStrip dues={dues} />
          </div>
        )}

        {/* rewards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Lifetime cashback" value={formatINR(d.lifetimeCashback)} />
          <Stat label="Lifetime points" value={d.lifetimePoints.toLocaleString("en-IN")} />
          <Stat label="Cashback this cycle" value={formatINR(d.cashbackThisCycle)} />
          <Stat label="Points this cycle" value={d.pointsThisCycle.toLocaleString("en-IN")} />
        </div>

        {/* configure card */}
        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
            ⚙️ Configure card
          </summary>
          <form action={setCreditConfig} className="grid grid-cols-1 gap-3 border-t border-slate-100 p-4 sm:grid-cols-3">
            <input type="hidden" name="id" value={account.id} />
            <label className="text-xs font-medium text-slate-500">Credit limit (₹)
              <input name="creditLimit" defaultValue={cfg?.creditLimit ?? ""} inputMode="numeric" className="input mt-1 w-full" />
            </label>
            <label className="text-xs font-medium text-slate-500">Statement day (1–28)
              <input name="statementDay" defaultValue={cfg?.statementDay ?? ""} inputMode="numeric" className="input mt-1 w-full" />
            </label>
            <label className="text-xs font-medium text-slate-500">Due after (days)
              <input name="dueOffsetDays" defaultValue={cfg?.dueOffsetDays ?? ""} inputMode="numeric" className="input mt-1 w-full" />
            </label>
            <label className="text-xs font-medium text-slate-500">Remind me before (days)
              <input name="reminderDays" defaultValue={cfg?.reminderDays ?? ""} inputMode="numeric" placeholder="5" className="input mt-1 w-full" />
            </label>
            <div className="sm:col-span-3">
              <button className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Save</button>
            </div>
          </form>
        </details>

        {/* transactions */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Transactions <span className="text-slate-400">({txns.length})</span></h2>
          </div>

          {/* quick manual add */}
          <form action={addManualTransaction} className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3 text-sm">
            <input type="hidden" name="accountId" value={account.id} />
            <input name="date" type="date" required className="input" />
            <input name="merchant" required placeholder="Merchant" className="input flex-1" />
            <input name="amount" inputMode="numeric" required placeholder="₹" className="input w-24" />
            <select name="type" className="input w-28">
              {TXN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Add</button>
          </form>

          <ul className="divide-y divide-slate-100">
            {txns.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">No transactions yet.</li>}
            {txns.map((t) => (
              <li key={t.id} className={`flex items-center justify-between gap-2 px-4 py-2.5 text-sm ${t.needsReview ? "bg-amber-50/60" : ""}`}>
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800">
                    {t.merchant}
                    {t.needsReview && <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">review</span>}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {fmtDate(t.date)} · {t.type}{t.rewardPoints ? ` · ${t.rewardPoints} pts` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`tabular-nums ${t.type === "payment" || t.type === "refund" || t.type === "cashback" ? "text-emerald-600" : "text-slate-700"}`}>
                    {formatINR(t.amount)}
                  </span>
                  <ConfirmForm action={deleteTransaction} message="Remove this transaction?">
                    <input type="hidden" name="id" value={t.id} />
                    <button className="text-slate-300 hover:text-red-600">✕</button>
                  </ConfirmForm>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}

function Stat({ label, value, big, danger }: { label: string; value: string; big?: boolean; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 font-bold tabular-nums ${big ? "text-2xl" : "text-lg"} ${danger ? "text-red-600" : "text-slate-800"}`}>{value}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-700">{value}</div>
    </div>
  );
}
