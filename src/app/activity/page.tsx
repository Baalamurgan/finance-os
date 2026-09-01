import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getMonthChanges } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return null;

  const nav = (
    <NavHeader
      active="activity"
      householdName={c.household.name}
      miscSubCategories={c.miscSubCategories}
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

  const changes = c.selected ? await getMonthChanges(c.household.id, c.selected.id) : null;

  const nonEmpty = (d?: { added: unknown[]; removed: unknown[]; changed: unknown[] } | null) =>
    !!d && (d.added.length > 0 || d.removed.length > 0 || d.changed.length > 0);
  const hasChanges = nonEmpty(changes?.income) || nonEmpty(changes?.expense) || nonEmpty(changes?.misc);

  return (
    <>
      {nav}
      <main className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">What changed</h1>
          <p className="text-sm text-slate-500">
            This month&apos;s sheet compared with last month.
          </p>
        </div>

        {/* What changed since last month — everyone */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            What changed vs {changes?.prevLabel ?? "last month"}
          </h2>
          {!changes?.prevLabel ? (
            <p className="mt-2 text-sm text-slate-400">No previous month to compare with yet.</p>
          ) : !hasChanges ? (
            <p className="mt-2 text-sm text-slate-400">Nothing changed from {changes.prevLabel} — same sheet.</p>
          ) : (
            <div className="mt-3 space-y-4">
              <ChangeBlock title="Income" diff={changes.income!} />
              <ChangeBlock title="Expenses" diff={changes.expense!} />
              {nonEmpty(changes.misc) && (
                <div className="rounded-lg bg-slate-50 p-3">
                  <ChangeBlock title="Miscellaneous (one-off)" diff={changes.misc!} collapsible />
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function ChangeBlock({
  title,
  diff,
  collapsible,
}: {
  title: string;
  diff: {
    added: { label: string; amount: number }[];
    removed: { label: string; amount: number }[];
    changed: { label: string; from: number; to: number }[];
  };
  collapsible?: boolean;
}) {
  const n = diff.added.length + diff.changed.length + diff.removed.length;
  if (n === 0) return null;
  const rows = (
    <ul className="mt-1 space-y-1 text-sm">
      {diff.added.map((r, i) => (
        <li key={`a${i}`} className="flex justify-between gap-2">
          <span className="text-emerald-700">＋ Added “{r.label}”</span>
          <span className="tabular-nums text-emerald-700">{formatINR(r.amount)}</span>
        </li>
      ))}
      {diff.changed.map((r, i) => (
        <li key={`c${i}`} className="flex justify-between gap-2">
          <span className="text-amber-700">✎ “{r.label}”</span>
          <span className="tabular-nums text-amber-700">
            {formatINR(r.from)} → {formatINR(r.to)}
          </span>
        </li>
      ))}
      {diff.removed.map((r, i) => (
        <li key={`r${i}`} className="flex justify-between gap-2">
          <span className="text-red-600">✕ Removed “{r.label}”</span>
          <span className="tabular-nums text-red-600">{formatINR(r.amount)}</span>
        </li>
      ))}
    </ul>
  );

  // Misc churns every month, so it gets a collapsible block (collapsed by default) to keep the
  // Income/Expense diffs — the ones people actually watch — front and centre.
  if (collapsible) {
    return (
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 [&::-webkit-details-marker]:hidden">
          {title}
          <span className="font-normal normal-case text-slate-400">· {n}</span>
          <svg width="14" height="14" viewBox="0 0 20 20" className="ml-auto shrink-0 transition-transform group-open:rotate-90" aria-hidden>
            <path fill="currentColor" d="M7 5l6 5-6 5z" />
          </svg>
        </summary>
        {rows}
      </details>
    );
  }
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      {rows}
    </div>
  );
}
