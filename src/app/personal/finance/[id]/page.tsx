import Link from "next/link";
import { redirect } from "next/navigation";
import { formatINR, pctLabel } from "@/lib/format";
import { loadPersonal } from "@/lib/loadPersonal";
import { getAccountDetail } from "@/lib/finance/queries";
import { getCardDues } from "@/lib/personal/cash";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { CardDuesStrip } from "@/components/personal/CardDuesStrip";
import { ConfirmForm } from "@/components/ConfirmForm";
import { setCreditConfig, deleteTransaction, addManualTransaction, addPointsRedemption, topUpCard, updateAccount, deleteAccount } from "@/app/personal/finance/actions";
import { TXN_TYPES, BALANCE_ACCOUNT_TYPES, CARD_NETWORKS } from "@/lib/finance/types";
import { CardColorPicker } from "@/components/CardColorPicker";
import { ToastForm } from "@/components/ToastForm";

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
  if (!detail) redirect("/personal/finance");

  const { account, txns, dashboard: d, balance } = detail;
  const isCredit = account.type === "credit_card";
  const isBalance = BALANCE_ACCOUNT_TYPES.has(account.type);
  const typeLabel = isCredit ? "credit card" : account.type === "prepaid_card" ? "prepaid card / wallet" : "debit card";
  const cfg = account.credit;
  // The in-app spends/fixed lines tagged to THIS card that are still deferred from cash
  // (grouped into bill cycles), so you can view exactly what's riding on this card. Credit-only.
  const dues = isCredit ? (await getCardDues(c.member.id)).filter((due) => due.cardId === account.id) : [];

  return (
    <>
      <PersonalNav active="finance" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} financeDue={c.cardReminders.length > 0} />
      <main className="mx-auto max-w-3xl space-y-5 p-4 pb-24 sm:p-6">
        <div>
          <Link href="/personal/finance?tab=cards" className="text-xs font-medium text-emerald-700 hover:underline">← All cards</Link>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-3.5 w-3.5 rounded-full" style={{ background: account.color }} />
            <h1 className="text-xl font-bold text-slate-900">{account.name}</h1>
          </div>
          <p className="text-xs text-slate-400">
            {[account.institution, account.network?.toUpperCase(), account.last4 && `XX${account.last4}`].filter(Boolean).join(" · ") || typeLabel}
          </p>
        </div>

        {/* Debit/prepaid: available balance + top up */}
        {isBalance && (
          <>
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-50 to-white p-5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Available balance</div>
              <div className={`mt-1 text-4xl font-extrabold tabular-nums ${(balance ?? 0) < 0 ? "text-red-600" : "text-emerald-700"}`}>
                {formatINR(balance ?? 0)}
              </div>
              <div className="mt-1 text-xs text-slate-400">Opening {formatINR(account.openingBalance ?? 0)} · every top-up and spend adjusts it.</div>
            </div>
            <ToastForm action={topUpCard} successMessage="Topped up" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <input type="hidden" name="accountId" value={account.id} />
              <label className="text-xs font-medium text-slate-500">Top up (₹)
                <input name="amount" inputMode="numeric" required placeholder="0" className="input mt-1 w-32" />
              </label>
              <label className="text-xs font-medium text-slate-500">Note
                <input name="note" placeholder="e.g. Salary load" className="input mt-1 w-40" />
              </label>
              <button className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">+ Top up</button>
            </ToastForm>
          </>
        )}

        {/* headline: outstanding / available / utilisation */}
        {isCredit && (<>
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

        {/* rewards + profit/loss */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Lifetime cashback" value={formatINR(d.lifetimeCashback)} />
          <Stat label="Lifetime fees" value={formatINR(d.lifetimeFees)} />
          <Stat label="Lifetime points" value={d.lifetimePoints.toLocaleString("en-IN")} />
          <Stat label="Points this cycle" value={d.pointsThisCycle.toLocaleString("en-IN")} />
        </div>

        {/* Card profit / loss = cashback (incl. redeemed points) − fees. + = the card earns you money. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Card profit / loss</div>
            <div className={`mt-0.5 text-2xl font-extrabold tabular-nums ${d.netRewards < 0 ? "text-red-600" : "text-emerald-700"}`}>
              {d.netRewards < 0 ? `− ${formatINR(-d.netRewards)}` : `+ ${formatINR(d.netRewards)}`}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">cashback {formatINR(d.lifetimeCashback)} − fees {formatINR(d.lifetimeFees)}</div>
          </div>
          <ToastForm action={addPointsRedemption} successMessage="Points value added" className="flex items-end gap-2">
            <input type="hidden" name="accountId" value={account.id} />
            <label className="text-[11px] font-medium text-slate-500">Redeem points → ₹
              <input name="amount" inputMode="numeric" required placeholder="0" className="input mt-1 w-24" />
            </label>
            <label className="text-[11px] font-medium text-slate-500">Points (opt.)
              <input name="rewardPoints" inputMode="numeric" placeholder="0" className="input mt-1 w-20" />
            </label>
            <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">+ Add</button>
          </ToastForm>
        </div>

        {/* configure card */}
        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
            ⚙️ Configure card
          </summary>
          <ToastForm action={setCreditConfig} successMessage="Card settings saved" className="grid grid-cols-1 gap-3 border-t border-slate-100 p-4 sm:grid-cols-3">
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
            <label className="text-xs font-medium text-slate-500">Annual fee (₹)
              <input name="annualFee" defaultValue={cfg?.annualFee ?? ""} inputMode="numeric" placeholder="optional" className="input mt-1 w-full" />
            </label>
            <label className="text-xs font-medium text-slate-500">Fee charged in month (1–12)
              <input name="annualFeeMonth" defaultValue={cfg?.annualFeeMonth ?? ""} inputMode="numeric" min={1} max={12} placeholder="e.g. 4 = Apr" className="input mt-1 w-full" />
            </label>
            <div className="sm:col-span-3">
              <button className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Save</button>
            </div>
          </ToastForm>
        </details>
        </>)}

        {/* edit / delete card — all card types */}
        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
            ✏️ Edit card
          </summary>
          <ToastForm action={updateAccount} successMessage="Card updated" className="grid grid-cols-1 gap-3 border-t border-slate-100 p-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={account.id} />
            <label className="text-xs font-medium text-slate-500 sm:col-span-2">Card name
              <input name="name" defaultValue={account.name} required className="input mt-1 w-full" />
            </label>
            <label className="text-xs font-medium text-slate-500">Bank / issuer
              <input name="institution" defaultValue={account.institution ?? ""} className="input mt-1 w-full" />
            </label>
            <label className="text-xs font-medium text-slate-500">Network
              <select name="network" defaultValue={account.network ?? ""} className="input mt-1 w-full">
                <option value="">—</option>
                {CARD_NETWORKS.map((nw) => <option key={nw} value={nw}>{nw[0].toUpperCase() + nw.slice(1)}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-500">Last 4 digits
              <input name="last4" inputMode="numeric" maxLength={4} defaultValue={account.last4 ?? ""} className="input mt-1 w-full" />
            </label>
            <div className="text-xs font-medium text-slate-500">Colour
              <CardColorPicker defaultValue={account.color} />
            </div>
            {isBalance && (
              <label className="text-xs font-medium text-slate-500 sm:col-span-2">Opening balance (₹)
                <input name="openingBalance" inputMode="numeric" defaultValue={account.openingBalance ?? 0} className="input mt-1 w-full" />
                <span className="mt-1 block text-[11px] text-slate-400">A correction to the starting point — top-ups and spends adjust from here.</span>
              </label>
            )}
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600 sm:col-span-2">
              <input type="checkbox" name="active" defaultChecked={account.active} className="h-4 w-4 accent-emerald-600" />
              Active (show it in the &ldquo;Paid with&rdquo; picker)
            </label>
            <div className="flex items-center justify-between sm:col-span-2">
              <button className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Save</button>
            </div>
          </ToastForm>
          <div className="border-t border-slate-100 p-4">
            <ConfirmForm action={deleteAccount} successMessage="Card deleted" message={`Delete “${account.name}”? Its transactions are removed too. Family spends made on it keep their attribution.`}>
              <input type="hidden" name="id" value={account.id} />
              <button className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50">Delete card</button>
            </ConfirmForm>
          </div>
        </details>

        {/* transactions */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Transactions <span className="text-slate-400">({txns.length})</span></h2>
          </div>

          {/* quick manual add */}
          <ToastForm action={addManualTransaction} successMessage="Transaction added" className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3 text-sm">
            <input type="hidden" name="accountId" value={account.id} />
            <input name="date" type="date" required className="input" />
            <input name="merchant" required placeholder="Merchant" className="input flex-1" />
            <input name="amount" inputMode="numeric" required placeholder="₹" className="input w-24" />
            <select name="type" className="input w-28">
              {TXN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Add</button>
          </ToastForm>

          <ul className="divide-y divide-slate-100">
            {txns.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">No transactions yet.</li>}
            {txns.map((t) => (
              <li key={t.id} className={`flex items-center justify-between gap-2 px-4 py-2.5 text-sm ${t.needsReview ? "bg-amber-50/60" : ""}`}>
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800">
                    {t.merchant}
                    {t.needsReview && <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">review</span>}
                    {t.source === "family" && <span className="ml-2 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">Family</span>}
                    {t.personalSpendId != null && <span className="ml-2 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">Spend</span>}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {fmtDate(t.date)} · {t.type}{t.rewardPoints ? ` · ${t.rewardPoints} pts` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`tabular-nums ${t.type === "payment" || t.type === "refund" || t.type === "cashback" ? "text-emerald-600" : "text-slate-700"}`}>
                    {formatINR(t.amount)}
                  </span>
                  {t.source === "family" || t.personalSpendId != null ? (
                    <span className="w-4 text-center text-slate-200" title={t.source === "family" ? "Family spend — edit or remove it from the Family view" : "Your spend — edit or remove it from the Spends tab"}>🔒</span>
                  ) : (
                    <ConfirmForm action={deleteTransaction} successMessage="Transaction removed" message="Remove this transaction?">
                      <input type="hidden" name="id" value={t.id} />
                      <button className="text-slate-300 hover:text-red-600">✕</button>
                    </ConfirmForm>
                  )}
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
