import Link from "next/link";
import { formatINR } from "@/lib/format";
import { loadPersonal } from "@/lib/loadPersonal";
import { getWalletAccounts } from "@/lib/finance/queries";
import { getCardDues } from "@/lib/personal/cash";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { AddAccountModal } from "@/components/personal/AddAccountModal";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";

// The full bill you pay the card = your personal dues + any family/peer spends it fronts.
const fullUnpaid = (d: { unpaidTotal: number; familyUnpaidTotal: number }) => d.unpaidTotal + d.familyUnpaidTotal;

export default async function PersonalCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const financeDue = c.cardReminders.length > 0;
  const [wallet, dues] = await Promise.all([getWalletAccounts(c.member.id), getCardDues(c.member.id)]);

  // Per credit card: the soonest unpaid cycle (what's due), else the latest settled one (bill paid).
  const dueByCard = new Map(dues.map((d) => {
    const next = d.cycles[0] ?? null; // unpaid, oldest first
    const lastPaid = d.paid.length ? [...d.paid].sort((a, b) => b.cycleEndISO.localeCompare(a.cycleEndISO))[0] : null;
    return [d.cardId, { next, lastPaid, toPay: fullUnpaid(d), needsStatementDay: d.needsStatementDay }];
  }));

  return (
    <>
      <PersonalNav active="cards" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} financeDue={financeDue} />
      <main className="mx-auto max-w-3xl space-y-5 p-4 pb-24 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Cards</h1>
            <p className="text-sm text-slate-500">Your credit, debit &amp; prepaid cards — bills, due dates and balances.</p>
          </div>
          <AddAccountModal />
        </div>

        <section className="space-y-2">
          {wallet.map(({ account, summary, balance }) => {
            const typeLabel = account.type === "credit_card" ? "Credit" : account.type === "prepaid_card" ? "Prepaid" : "Debit";
            const meta = [typeLabel, account.institution, account.last4 && `XX${account.last4}`].filter(Boolean).join(" · ");
            const info = dueByCard.get(account.id);

            return (
              <Link key={account.id} href={`/personal/finance/${account.id}`} className="block hover:opacity-80">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: account.color }} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-800">{account.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {meta}
                        {account.type === "credit_card" && summary?.hasLimit ? ` · ${Math.round(summary.utilPct ?? 0)}% used` : ""}
                      </div>
                    </div>
                  </div>

                  {account.type === "credit_card" ? (
                    <CreditStatus info={info} />
                  ) : (
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums text-emerald-700">{formatINR(balance ?? 0)}</span>
                      <span className="block text-[10px] text-slate-400">balance ›</span>
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
          {wallet.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              No cards yet — add one to track its bills, due dates and balance.
            </p>
          )}
        </section>
      </main>
    </>
  );
}

// Right-side status for a credit card: what's due (with the due date), or ✓ Bill paid (with the due
// date it was cleared for) when nothing is outstanding.
function CreditStatus({
  info,
}: {
  info?: { next: { dueISO: string | null } | null; lastPaid: { dueISO: string | null; cycleEndISO: string } | null; toPay: number; needsStatementDay: boolean };
}) {
  if (!info || info.needsStatementDay) {
    return <span className="shrink-0 text-right text-xs text-amber-600">set up ›</span>;
  }
  if (info.toPay > 0.005 && info.next) {
    return (
      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold tabular-nums text-red-600">{formatINR(info.toPay)}</span>
        <span className="block text-[10px] text-slate-400">due {fmtDate(info.next.dueISO)} ›</span>
      </span>
    );
  }
  // nothing outstanding → last bill settled
  return (
    <span className="shrink-0 text-right">
      <span className="block text-xs font-semibold text-emerald-600">✓ Bill paid</span>
      {info.lastPaid && <span className="block text-[10px] text-slate-400">due was {fmtDate(info.lastPaid.dueISO ?? info.lastPaid.cycleEndISO)} ›</span>}
    </span>
  );
}
