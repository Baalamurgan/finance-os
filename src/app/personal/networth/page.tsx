import Link from "next/link";
import { formatINR } from "@/lib/format";
import { loadPersonal } from "@/lib/loadPersonal";
import { getNetWorthOverview, type Holding } from "@/lib/finance/networth";
import { netWorthTypeMeta, ASSET_TYPES } from "@/lib/finance/types";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { NetWorthItemModal } from "@/components/personal/NetWorthItemModal";
import { NetWorthTrend } from "@/components/personal/NetWorthTrend";
import { HoldingCard } from "@/components/personal/HoldingCard";
import { ConfirmForm } from "@/components/ConfirmForm";
import { deleteNetWorthItem } from "@/app/personal/finance/actions";

// One summary tile under the net worth hero.
function Stat({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "neg" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-base font-bold tabular-nums ${tone === "neg" ? "text-rose-600" : "text-slate-800"}`}>{tone === "neg" && value > 0 ? "−" : ""}{formatINR(value)}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

// PERSONAL net worth — only ever rendered in the personal app (behind its own PIN), member-scoped.
export default async function NetWorthPage({ searchParams }: { searchParams: Promise<{ y?: string; m?: string }> }) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const nw = await getNetWorthOverview(c.member.id);
  const change = nw.lastMonth != null ? Math.round((nw.netWorth - nw.lastMonth) * 100) / 100 : null;
  const gain = Math.round((nw.holdingsTotal - nw.investedTotal) * 100) / 100;

  // Holdings grouped by type, in the order of the type list (MF, FD, gold…), biggest first inside a group.
  const order = new Map(ASSET_TYPES.map((t, i) => [t.key, i]));
  const groups = new Map<string, Holding[]>();
  for (const h of [...nw.holdings].sort((a, b) => (order.get(a.type) ?? 99) - (order.get(b.type) ?? 99) || b.value - a.value)) {
    (groups.get(h.type) ?? groups.set(h.type, []).get(h.type)!).push(h);
  }

  return (
    <>
      <PersonalNav active="networth" account={c.account} selYear={c.selYear} selMonth={c.selMonth} financeDue={c.cardReminders.length > 0} />
      <main className="mx-auto max-w-3xl space-y-5 p-4 pb-24 sm:p-6">
        {/* Hero: the number, how it moved, the trend */}
        <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-50 to-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Net worth</div>
              <div className={`mt-1 text-4xl font-extrabold tabular-nums ${nw.netWorth < 0 ? "text-rose-600" : "text-slate-900"}`}>{formatINR(nw.netWorth)}</div>
              {change != null && (
                <div className={`mt-1 text-xs font-medium ${change >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                  {change >= 0 ? "▲" : "▼"} {formatINR(Math.abs(change))} since last month
                </div>
              )}
            </div>
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200" title="Only in your personal app — never shown to the family">🔒 Only you</span>
          </div>
          <div className="mt-3"><NetWorthTrend points={nw.trend} /></div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Stat label="Bank & cash" value={nw.accountsTotal} sub={`${nw.accounts.length} account${nw.accounts.length === 1 ? "" : "s"}`} />
            <Stat label="Investments" value={nw.holdingsTotal} sub={nw.investedTotal > 0 ? `${gain >= 0 ? "+" : "−"}${formatINR(Math.abs(gain))} on ${formatINR(nw.investedTotal)}` : undefined} />
            <Stat label="Owed to you" value={nw.lent} sub="Lending" />
            <Stat label="You owe" value={nw.liabilities} sub="card bills · loans" tone="neg" />
          </div>
        </section>

        {/* Investments */}
        <section>
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Investments</h2>
              <p className="text-[11px] text-slate-500">Monthly investments from Setup add here automatically when you tick them in the Money Plan.</p>
            </div>
            <NetWorthItemModal category="asset" />
          </div>
          {nw.holdings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
              <p className="font-medium text-slate-700">Add what you already have</p>
              <p className="mt-1 text-xs">Mutual funds, FDs, gold, APY/EPF/PPF… enter each with what it&apos;s worth today and what you&apos;ve put in. Then link your monthly investments in <Link href="/personal/setup" className="font-medium text-emerald-700 underline">Setup</Link> so every tick adds to them.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {[...groups.entries()].map(([type, list]) => {
                const meta = netWorthTypeMeta(type);
                const total = list.reduce((t, h) => t + h.value, 0);
                return (
                  <div key={type}>
                    <div className="mb-1.5 flex items-baseline justify-between px-1 text-xs">
                      <span className="font-medium text-slate-600">{meta.icon} {meta.label}</span>
                      <span className="tabular-nums text-slate-500">{formatINR(total)}</span>
                    </div>
                    <ul className="space-y-2">{list.map((h) => <HoldingCard key={h.id} h={h} />)}</ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Bank & cash (live from your accounts) */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Bank &amp; cash</h2>
            <span className="text-sm font-bold tabular-nums text-slate-800">{formatINR(nw.accountsTotal)}</span>
          </div>
          <p className="text-[11px] text-slate-500">Live balances — every Money Plan tick moves them.</p>
          <ul className="mt-2 divide-y divide-slate-100">
            {nw.accounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-1.5 text-sm">
                <Link href={`/personal/finance/${a.id}`} className="flex items-center gap-2 text-slate-700 hover:text-emerald-700">
                  <span className="h-2 w-2 rounded-full" style={{ background: a.color }} />{a.name}
                </Link>
                <span className={`tabular-nums ${a.balance < 0 ? "text-rose-600" : "text-slate-700"}`}>{formatINR(a.balance)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* What you owe */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-900">You owe</h2>
            <span className="text-sm font-bold tabular-nums text-rose-600">−{formatINR(nw.liabilities)}</span>
          </div>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            <li className="flex justify-between py-1.5"><Link href="/personal/cards" className="text-slate-700 hover:text-emerald-700">💳 Card bills (your share)</Link><span className="tabular-nums text-slate-700">{formatINR(nw.cardDues)}</span></li>
            {nw.borrowed > 0 && <li className="flex justify-between py-1.5"><Link href="/personal/loans" className="text-slate-700 hover:text-emerald-700">🤝 Borrowed</Link><span className="tabular-nums text-slate-700">{formatINR(nw.borrowed)}</span></li>}
            {nw.loans.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="text-slate-700">{netWorthTypeMeta(l.type).icon} {l.name}{l.institution ? <span className="text-[11px] text-slate-400"> · {l.institution}</span> : null}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-slate-700">{formatINR(l.value)}</span>
                  <NetWorthItemModal category="liability" initial={{ id: l.id, type: l.type, name: l.name, value: l.value, quantity: l.quantity, institution: l.institution, notes: l.notes }} trigger="pencil" />
                  <ConfirmForm action={deleteNetWorthItem} message={`Remove ${l.name}?`}>
                    <input type="hidden" name="id" value={l.id} />
                    <button type="submit" aria-label="Remove" className="text-slate-300 hover:text-red-600">✕</button>
                  </ConfirmForm>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2"><NetWorthItemModal category="liability" /></div>
        </section>
      </main>
    </>
  );
}
