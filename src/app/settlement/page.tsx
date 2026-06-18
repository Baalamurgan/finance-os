import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getSettlement, getSettlementHistory } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { setTreasurer, markSettled, unsettle } from "../actions";

export default async function SettlementPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
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
      members={c.members}
      categories={c.categories}
      account={c.account}
      isHead={c.isHead}
      piggyBalance={c.piggyBalance}
      periodId={c.selected?.id ?? null}
      periodOpen={c.selected?.status === "open"}
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
  // treasurer = household setting, else the head, else first member
  const headId = c.members.find((m) => m.role === "head")?.id ?? c.members[0]?.id ?? null;
  const treasurerId = c.household.treasurerMemberId ?? headId;
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
          {c.isHead && (
            <form action={setTreasurer} className="flex items-center gap-2">
              <input type="hidden" name="householdId" value={c.household.id} />
              <label className="text-xs text-slate-500">Treasurer</label>
              <select
                name="treasurerMemberId"
                defaultValue={treasurerId ?? ""}
                className="input"
              >
                {c.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button className="btn">Set</button>
            </form>
          )}
        </div>

        {/* who owes whom */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">
              Who owes whom{" "}
              {treasurer && <span className="text-slate-400">(hub: {treasurer.name})</span>}
            </h2>
            {total > 0 &&
              (allSettled ? (
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                  ✓ Fully settled
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  {settledCount} of {total} settled
                </span>
              ))}
          </div>
          {transfers.length === 0 ? (
            <p className="text-sm text-slate-400">All square — no transfers needed.</p>
          ) : (
            <ul className="space-y-2">
              {transfers.map((t, i) => (
                <li
                  key={i}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 ${
                    t.settled ? "bg-green-50" : "bg-slate-50"
                  }`}
                >
                  <span className="text-sm">
                    <b className="text-slate-800">{t.from}</b>
                    <span className="mx-2 text-indigo-500">→</span>
                    <b className="text-slate-800">{t.to}</b>
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold tabular-nums text-indigo-700">
                      {formatINR(t.amount)}
                    </span>
                    {t.settled ? (
                      <span className="flex items-center gap-2">
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          ✓ Settled{t.settledAt ? ` ${fmtDate(t.settledAt)}` : ""}
                        </span>
                        {t.amountChanged && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                            amount changed since
                          </span>
                        )}
                        {c.isHead && t.recordId && (
                          <form action={unsettle}>
                            <input type="hidden" name="id" value={t.recordId} />
                            <button className="text-xs text-slate-400 hover:text-red-600">
                              Undo
                            </button>
                          </form>
                        )}
                      </span>
                    ) : (
                      c.isHead && (
                        <form action={markSettled}>
                          <input type="hidden" name="householdId" value={c.household.id} />
                          <input type="hidden" name="periodId" value={selectedId} />
                          <input type="hidden" name="fromMemberId" value={t.fromId} />
                          <input type="hidden" name="toMemberId" value={t.toId} />
                          <input type="hidden" name="amount" value={t.amount} />
                          <button className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700">
                            Mark paid
                          </button>
                        </form>
                      )
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* per-member breakdown */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                <th className="px-4 py-2">Member</th>
                <th className="px-4 py-2 text-right">Contributed</th>
                <th className="px-4 py-2 text-right">Paid</th>
                <th className="px-4 py-2 text-right">Net</th>
                <th className="px-4 py-2 text-right">Position</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isTreasurer = treasurer?.id === r.id;
                return (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-800">
                      {r.name}
                      {isTreasurer && (
                        <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                          treasurer
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                      {formatINR(r.contributed)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                      {formatINR(r.paid)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums font-medium ${
                        r.net > 0 ? "text-green-600" : r.net < 0 ? "text-red-600" : "text-slate-400"
                      }`}
                    >
                      {formatINR(r.net)}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-slate-500">
                      {isTreasurer
                        ? "—"
                        : r.net > 0
                          ? `pays ${treasurer?.name ?? "hub"}`
                          : r.net < 0
                            ? `gets from ${treasurer?.name ?? "hub"}`
                            : "settled"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

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
          Contributed = salary/income owned by the member. Paid = expenses &amp; spends tagged to
          them. Rent and untagged items stay with the treasurer&apos;s pool.
        </p>
      </main>
    </>
  );
}
