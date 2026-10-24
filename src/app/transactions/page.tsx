import { loadCommon } from "@/lib/load";
import { getTransactionLedger } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { Transactions } from "@/components/Transactions";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return null;

  const nav = (
    <NavHeader
      active="transactions"
      householdName={c.household.name}
      miscSubCategories={c.miscSubCategories}
      selYear={c.selYear}
      selMonth={c.selMonth}
      previewPeriod={c.previewPeriod}
      provisional={c.provisional}
      members={c.members}
      categories={c.categories}
      account={c.account}
      isHead={c.isHead}
      piggyBalance={c.piggyBalance}
      periodId={c.selected?.id ?? null}
      periodOpen={c.selected?.status === "open"}
      currentMemberId={c.currentMember?.id}
      windDownReminder={c.windDownReminder}
      canEdit={c.canEdit}
      pinEnabled={c.pinEnabled}
      hasBiometric={c.hasBiometric}
      actualIsHead={c.actualIsHead}
      viewingAsMember={c.viewingAsMember}
    />
  );

  if (c.noData || !c.selected) {
    return (
      <>
        {nav}
        <main className="mx-auto max-w-2xl p-16 text-center text-slate-500">
          No month selected. Start a month on the Sheet tab first.
        </main>
      </>
    );
  }

  const ledgers = await getTransactionLedger(c.household.id, c.selected.id);

  return (
    <>
      {nav}
      <main className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">🧾 Transactions</h1>
          <p className="text-sm text-slate-500">
            Every rupee in and out this month, in date order — the running balance ends exactly at each
            person&apos;s in-hand.
          </p>
        </div>
        <Transactions
          ledgers={ledgers}
          monthLabel={MONTHS[c.selMonth] ?? ""}
          defaultMemberId={c.currentMember?.id ?? null}
        />
      </main>
    </>
  );
}
