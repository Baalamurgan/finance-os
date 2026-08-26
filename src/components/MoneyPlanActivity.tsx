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
  // Collapsible (native <details>, zero-JS). Collapsed by default — it's a reference log, not the main
  // view — with the count on the summary so you know there's history without expanding.
  return (
    <details className="group rounded-xl border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 p-4 text-sm font-semibold text-slate-700">
        📜 Money-plan activity
        <span className="text-[11px] font-normal text-slate-400">· {items.length} · newest first</span>
        <svg width="16" height="16" viewBox="0 0 20 20" className="ml-auto shrink-0 text-slate-400 transition-transform group-open:rotate-90" aria-hidden>
          <path fill="currentColor" d="M7 5l6 5-6 5z" />
        </svg>
      </summary>
      <ul className="divide-y divide-slate-100 px-4 pb-2">
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
    </details>
  );
}
