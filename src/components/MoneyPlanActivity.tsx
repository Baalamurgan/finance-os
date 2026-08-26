import type { MoneyPlanActivity as Activity } from "@/lib/queries";

// One combined, newest-first log of everything done in the Money Plan this month — who marked a
// settlement/bill/income done, piggy hand-overs, manual moves. Shown below the In-Hand cards as the
// audit trail: after someone ticks a step, this is where you see it happened (and can back-track a
// step that "disappeared" from the plan because it collapsed into a done line).
const ICON: Record<string, string> = { settlement: "🔁", piggy: "🐷", income: "💰", expense: "🧾" };
// Absolute IST timestamp — this is an audit feed cross-checked to the rupee, so a precise time
// ("Aug 24, 4:18 AM") is more useful than a relative "2 days ago" that also goes stale on the server.
const fmtAt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const verbClass: Record<string, string> = { created: "text-emerald-600", deleted: "text-red-500", updated: "text-slate-500" };

export function MoneyPlanActivity({ items }: { items: Activity[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        📜 Money-plan activity
        <span className="text-[11px] font-normal text-slate-400">· newest first</span>
      </h2>
      <ul className="divide-y divide-slate-100">
        {items.map((it) => (
          <li key={it.id} className="flex items-start gap-2.5 py-2 text-xs">
            <span className="mt-px shrink-0" aria-hidden>{ICON[it.entity] ?? "•"}</span>
            <div className="min-w-0 flex-1">
              <p className="text-slate-700">
                <span className="font-medium text-slate-900">{it.memberName ?? "Someone"}</span>
                {" — "}
                <span className={verbClass[it.action] ?? "text-slate-600"}>{it.summary}</span>
              </p>
              <p className="mt-0.5 text-[10px] tabular-nums text-slate-400">{fmtAt.format(it.at)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
