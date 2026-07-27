import Link from "next/link";
import { formatINR } from "@/lib/format";
import { loadPersonal } from "@/lib/loadPersonal";
import { getNetWorth, getWalletAccounts } from "@/lib/finance/queries";
import { getPersonalSavings } from "@/lib/personal/savings";
import { netWorthTypeMeta } from "@/lib/finance/types";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { FinanceHubTabs } from "@/components/personal/FinanceHubTabs";
import { PersonalSavingsCard } from "@/components/personal/PersonalSavingsCard";
import { NetWorthItemModal } from "@/components/personal/NetWorthItemModal";
import { AddAccountModal } from "@/components/personal/AddAccountModal";
import { ConfirmForm } from "@/components/ConfirmForm";
import { MoneyFlowDonut } from "@/components/Charts";
import { deleteNetWorthItem } from "@/app/personal/finance/actions";

const ALLOC_COLORS = ["#10b981", "#0ea5e9", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#ec4899", "#84cc16", "#6366f1", "#f97316", "#06b6d4", "#a855f7"];

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const tab = sp.tab === "cards" || sp.tab === "savings" ? sp.tab : "networth";
  const financeDue = c.cardReminders.length > 0;
  const nw = await getNetWorth(c.member.id);
  const wallet = await getWalletAccounts(c.member.id);
  const savings = tab === "savings" ? await getPersonalSavings(c.member.id) : null;

  const donutSegments = nw.allocation.map((a, i) => ({
    name: `${a.icon} ${a.label}`,
    value: a.value,
    color: ALLOC_COLORS[i % ALLOC_COLORS.length],
  }));

  return (
    <>
      <PersonalNav active="finance" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} financeDue={financeDue} />
      <main className="mx-auto max-w-3xl space-y-5 p-4 pb-24 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Finance</h1>
          <p className="text-sm text-slate-500">Net worth, your cards, and your savings pot — all in one place.</p>
        </div>

        <FinanceHubTabs tab={tab} financeDue={financeDue} />

        {tab === "savings" && (
          savings && c.selected ? (
            <PersonalSavingsCard balance={savings.balance} periodId={c.selected.id} periodLabel={c.selected.label} history={savings.history} />
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              Start a month first to move savings in and out of it.
            </p>
          )
        )}

        {tab === "networth" && (
        <>
        {/* hero */}
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-50 to-white p-5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Total net worth</div>
          <div className={`mt-1 text-4xl font-extrabold tabular-nums ${nw.netWorth < 0 ? "text-red-600" : "text-emerald-700"}`}>
            {formatINR(nw.netWorth)}
          </div>
          <div className="mt-3 flex gap-6 text-sm">
            <span className="text-slate-500">Assets <b className="tabular-nums text-emerald-700">{formatINR(nw.totalAssets)}</b></span>
            <span className="text-slate-500">Liabilities <b className="tabular-nums text-red-600">{formatINR(nw.totalLiabilities)}</b></span>
          </div>
        </div>

        {!nw.hasAny && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            Start by adding what you own (stocks, MF, FDs, PF, property, gold…) and what you owe.
            Your cards and lending/borrowing fold in automatically.
          </div>
        )}

        {/* allocation */}
        {nw.totalAssets > 0 && donutSegments.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Where your money is</h2>
            <MoneyFlowDonut segments={donutSegments} centerLabel="Assets" centerValue={formatINR(nw.totalAssets)} />
          </div>
        )}

        {/* assets */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Assets <span className="tabular-nums text-emerald-700">{formatINR(nw.totalAssets)}</span></h2>
            <NetWorthItemModal category="asset" />
          </div>
          <ul className="divide-y divide-slate-100">
            {nw.assetItems.map((it) => (
              <ItemRow key={it.id} item={it} tone="emerald" />
            ))}
            {nw.lentOutstanding > 0 && (
              <AutoRow icon="🤝" name="Money lent to others" sub="from Lending & borrowing" value={nw.lentOutstanding} href="/personal/loans" tone="emerald" />
            )}
            {nw.assetItems.length === 0 && nw.lentOutstanding === 0 && (
              <li className="px-4 py-5 text-center text-sm text-slate-400">No assets yet — add stocks, MF, FDs, PF, property…</li>
            )}
          </ul>
        </section>

        {/* liabilities */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Liabilities <span className="tabular-nums text-red-600">{formatINR(nw.totalLiabilities)}</span></h2>
            <NetWorthItemModal category="liability" />
          </div>
          <ul className="divide-y divide-slate-100">
            {nw.liabilityItems.map((it) => (
              <ItemRow key={it.id} item={it} tone="red" />
            ))}
            {nw.borrowedOutstanding > 0 && (
              <AutoRow icon="🤝" name="Money you borrowed" sub="from Lending & borrowing" value={nw.borrowedOutstanding} href="/personal/loans" tone="red" />
            )}
            {nw.cards.map((card) => (
              <AutoRow key={card.id} icon="💳" name={card.name} sub="credit card outstanding" value={card.outstanding} href={`/personal/finance/${card.id}`} tone="red" dot={card.color} />
            ))}
            {nw.liabilityItems.length === 0 && nw.borrowedOutstanding === 0 && nw.cards.length === 0 && (
              <li className="px-4 py-5 text-center text-sm text-slate-400">No liabilities — loans and card dues show up here.</li>
            )}
          </ul>
        </section>

        <p className="text-center text-[11px] text-slate-400">
          Values are what you enter — update them anytime. Lending/borrowing and card dues are pulled in automatically.
        </p>
        </>
        )}

        {/* Cards sub-tab: manage & open your cards */}
        {tab === "cards" && (
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold text-slate-800">💳 Your cards</span>
            <AddAccountModal />
          </div>
          <div className="space-y-2 p-4">
            {wallet.map(({ account, summary }) => {
              const inner = (
                <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: account.color }} />
                    <div>
                      <div className="text-sm font-medium text-slate-800">{account.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {[account.type === "credit_card" ? "Credit" : "Debit", account.institution, account.last4 && `•• ${account.last4}`].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  </div>
                  {account.type === "credit_card"
                    ? <span className="text-xs tabular-nums text-slate-500">{summary?.hasLimit ? `${Math.round(summary.utilPct ?? 0)}% used ›` : "set up ›"}</span>
                    : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400">info</span>}
                </div>
              );
              return account.type === "credit_card"
                ? <Link key={account.id} href={`/personal/finance/${account.id}`} className="block hover:opacity-80">{inner}</Link>
                : <div key={account.id}>{inner}</div>;
            })}
            {wallet.length === 0 && <p className="text-center text-sm text-slate-400">No cards yet.</p>}
          </div>
        </section>
        )}
      </main>
    </>
  );
}

type Item = { id: number; type: string; category: string; name: string; value: number; quantity: number | null; institution: string | null; notes: string | null };

function ItemRow({ item, tone }: { item: Item; tone: "emerald" | "red" }) {
  const meta = netWorthTypeMeta(item.type);
  return (
    <li className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="text-lg">{meta.icon}</span>
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-800">{item.name}</div>
          <div className="text-[11px] text-slate-400">
            {[meta.label, item.institution, item.quantity != null ? `${item.quantity} units` : null].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`tabular-nums font-medium ${tone === "red" ? "text-red-600" : "text-slate-800"}`}>{formatINR(item.value)}</span>
        <NetWorthItemModal category={item.category as "asset" | "liability"} initial={item} trigger="pencil" />
        <ConfirmForm action={deleteNetWorthItem} message={`Remove ${item.name}?`}>
          <input type="hidden" name="id" value={item.id} />
          <button className="text-slate-300 hover:text-red-600">✕</button>
        </ConfirmForm>
      </div>
    </li>
  );
}

function AutoRow({ icon, name, sub, value, href, tone, dot }: { icon: string; name: string; sub: string; value: number; href: string; tone: "emerald" | "red"; dot?: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-slate-50">
        <div className="flex min-w-0 items-center gap-2.5">
          {dot ? <span className="h-3 w-3 rounded-full" style={{ background: dot }} /> : <span className="text-lg">{icon}</span>}
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-800">{name}</div>
            <div className="text-[11px] text-slate-400">{sub} · auto ›</div>
          </div>
        </div>
        <span className={`tabular-nums font-medium ${tone === "red" ? "text-red-600" : "text-slate-800"}`}>{formatINR(value)}</span>
      </Link>
    </li>
  );
}
