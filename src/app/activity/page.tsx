import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getMonthChanges, getActivityLog } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";

function when(d: Date) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const ACTION_ICON: Record<string, string> = { created: "＋", updated: "✎", deleted: "✕" };

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
      selYear={c.selYear}
      selMonth={c.selMonth}
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

  const changes = c.selected ? await getMonthChanges(c.household.id, c.selected.id) : null;
  const log = c.isHead ? await getActivityLog(c.household.id) : [];

  const nonEmpty = (d?: { added: unknown[]; removed: unknown[]; changed: unknown[] } | null) =>
    !!d && (d.added.length > 0 || d.removed.length > 0 || d.changed.length > 0);
  const hasChanges = nonEmpty(changes?.income) || nonEmpty(changes?.expense) || nonEmpty(changes?.misc);

  return (
    <>
      {nav}
      <main className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Activity</h1>
          <p className="text-sm text-slate-500">
            What changed this month{c.isHead ? ", and who changed what" : ""}.
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
                  <ChangeBlock title="Miscellaneous (one-off)" diff={changes.misc!} />
                </div>
              )}
            </div>
          )}
        </section>

        {/* Member activity log — head only */}
        {c.isHead && (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Member activity log</h2>
            <p className="mt-0.5 text-xs text-slate-500">Every money change, and who made it. Visible only to you.</p>
            {log.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">No activity recorded yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {log.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 py-2.5">
                    <span
                      className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs text-white ${
                        e.action === "deleted" ? "bg-red-500" : e.action === "updated" ? "bg-amber-500" : "bg-emerald-500"
                      }`}
                    >
                      {ACTION_ICON[e.action] ?? "•"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-700">{e.summary}</div>
                      <div className="text-xs text-slate-400">
                        {e.memberName ?? "Someone"} · {when(e.createdAt)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </>
  );
}

function ChangeBlock({
  title,
  diff,
}: {
  title: string;
  diff: {
    added: { label: string; amount: number }[];
    removed: { label: string; amount: number }[];
    changed: { label: string; from: number; to: number }[];
  };
}) {
  if (!diff.added.length && !diff.removed.length && !diff.changed.length) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
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
    </div>
  );
}
