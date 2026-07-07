import Link from "next/link";
import { formatINR } from "@/lib/format";
import { loadPersonal } from "@/lib/loadPersonal";
import { getWalletAccounts } from "@/lib/finance/queries";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { AddAccountModal } from "@/components/personal/AddAccountModal";

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const items = await getWalletAccounts(c.member.id);
  const credit = items.filter((i) => i.account.type === "credit_card");
  const debit = items.filter((i) => i.account.type === "debit_card");

  return (
    <>
      <PersonalNav active="finance" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} />
      <main className="mx-auto max-w-3xl space-y-5 p-4 pb-24 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Finance</h1>
            <p className="text-sm text-slate-500">Your cards and their spending.</p>
          </div>
          <AddAccountModal />
        </div>

        {items.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            No cards yet. Add your first credit or debit card to get started.
          </div>
        )}

        {credit.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Credit cards</h2>
            {credit.map(({ account, summary }) => (
              <Link
                key={account.id}
                href={`/personal/finance/${account.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-emerald-300 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: account.color }} />
                      <span className="truncate font-semibold text-slate-800">{account.name}</span>
                      {!account.active && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">inactive</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {[account.institution, account.network?.toUpperCase(), account.last4 && `•• ${account.last4}`].filter(Boolean).join(" · ") || "credit card"}
                    </div>
                  </div>
                  <span className="shrink-0 text-slate-300">›</span>
                </div>

                {summary?.hasLimit ? (
                  <div className="mt-3">
                    <UtilBar pct={summary.utilPct ?? 0} />
                    <div className="mt-1 flex justify-between text-xs">
                      <span className="text-slate-500">
                        Outstanding <b className="tabular-nums text-slate-700">{formatINR(summary.outstanding)}</b>
                      </span>
                      <span className="tabular-nums text-slate-400">
                        {Math.round(summary.utilPct ?? 0)}% of {formatINR(account.credit?.creditLimit ?? 0)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-amber-600">Set a credit limit &amp; statement day to see your dashboard →</p>
                )}
              </Link>
            ))}
          </section>
        )}

        {debit.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Debit cards</h2>
            {debit.map(({ account }) => (
              <div key={account.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: account.color }} />
                  <div>
                    <div className="font-semibold text-slate-800">{account.name}</div>
                    <div className="text-xs text-slate-400">
                      {[account.institution, account.network?.toUpperCase(), account.last4 && `•• ${account.last4}`].filter(Boolean).join(" · ") || "debit card"}
                    </div>
                  </div>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-400">info only</span>
              </div>
            ))}
          </section>
        )}
      </main>
    </>
  );
}

// green (low) → amber → red (high) utilisation bar; the grey mask hides the unused part.
function UtilBar({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="absolute inset-0" style={{ background: "linear-gradient(to right, #22c55e 0%, #eab308 60%, #ef4444 100%)" }} />
      <div className="absolute inset-y-0 right-0 bg-slate-100" style={{ width: `${100 - w}%` }} />
    </div>
  );
}
