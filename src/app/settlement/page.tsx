import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getSettlement, getSettlementHistory } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { SettlementBoard } from "@/components/SettlementBoard";

export default async function SettlementPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string; hub?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return null;

  const nav = (
    <NavHeader
      active="settlement"
      householdName={c.household.name}
      selYear={c.selYear}
      selMonth={c.selMonth}
      previewPeriod={c.previewPeriod}
      provisional={c.provisional}
      members={c.members}      categories={c.categories}
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
          No month selected to settle.
        </main>
      </>
    );
  }

  const selectedId = c.selected.id;
  // treasurer = ?hub query (shareable) → this month's saved override → household → head
  const headId = c.members.find((m) => m.role === "head")?.id ?? c.members[0]?.id ?? null;
  const hubParam = sp.hub ? Number(sp.hub) : null;
  // persisted default (ignores the shareable ?hub= override) — for disabling "Set default"
  const defaultId = c.selected.treasurerMemberId ?? c.household.treasurerMemberId ?? headId;
  const treasurerId = hubParam ?? defaultId;
  const { rows, treasurer, transfers, settledCount, total, allSettled } =
    await getSettlement(c.household.id, selectedId, treasurerId);
  const history = await getSettlementHistory(c.household.id);
  const pastHistory = history.filter((h) => h.periodId !== selectedId);
  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

  return (
    <>
      {nav}
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              Settlement — {c.selected.label}
            </h1>
            <p className="text-sm text-slate-500">
              Each member&apos;s salary in minus what they personally paid. Everyone settles the
              difference with the treasurer.
            </p>
          </div>
        </div>

        <SettlementBoard
          y={c.selYear}
          m={c.selMonth}
          householdId={c.household.id}
          periodId={selectedId}
          isHead={c.isHead}
          currentMemberId={c.currentMember?.id}
          members={c.members.map((mm) => ({ id: mm.id, name: mm.name }))}
          treasurerId={treasurerId}
          defaultId={defaultId}
          treasurerName={treasurer?.name ?? null}
          transfers={transfers}
          rows={rows}
          settledCount={settledCount}
          total={total}
          allSettled={allSettled}
        />

        {/* settlement history (past months) */}
        {pastHistory.length > 0 && (
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-700">
              History
            </h2>
            <div className="px-2 py-1">
              {pastHistory.map((h) => (
                <details key={h.periodId} className="group border-b border-slate-100 last:border-0">
                  <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-1.5">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 20 20"
                        className="text-slate-400 transition-transform group-open:rotate-90"
                      >
                        <path fill="currentColor" d="M7 5l6 5-6 5z" />
                      </svg>
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {h.label}
                      </span>
                      <span className="text-[10px] text-slate-400">({h.items.length})</span>
                    </span>
                    <span className="text-sm font-bold tabular-nums text-slate-700">
                      {formatINR(h.items.reduce((s, it) => s + it.amount, 0))}
                    </span>
                  </summary>
                  <ul className="divide-y divide-slate-100 px-3 pb-1">
                    {h.items.map((it) => (
                      <li key={it.id} className="flex items-center justify-between py-2 text-sm">
                        <span>
                          <b className="text-slate-800">{it.from}</b>
                          <span className="mx-2 text-indigo-500">→</span>
                          <b className="text-slate-800">{it.to}</b>
                          <span className="ml-2 text-xs text-slate-400">{fmtDate(it.settledAt)}</span>
                        </span>
                        <span className="tabular-nums text-slate-700">{formatINR(it.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </section>
        )}

        <p className="text-xs text-slate-400">
          Contributed = salary/income owned by the member. Paid = this month&apos;s tagged sheet
          expenses <b>plus last month&apos;s daily spends &amp; misc</b> tagged to them (spends are
          settled the month after they happen). Rent and untagged items stay with the
          treasurer&apos;s pool.
        </p>
      </main>
    </>
  );
}
