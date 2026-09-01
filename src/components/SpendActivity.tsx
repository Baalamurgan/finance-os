import { formatINR } from "@/lib/format";
import type { SpendActivityItem } from "@/lib/queries";

// Every daily spend for the month, newest first — who spent, on what, how much, when. Reads the
// Spend table (not the ActivityLog), so it's the complete list, matching the category cards above.
// Sits at the bottom of the Spends tab — the per-month spend visibility that used to live in the
// head-only "Member activity log", now open to everyone.
const fmtAt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

export function SpendActivity({ items }: { items: SpendActivityItem[] }) {
  if (items.length === 0) return null;
  // Collapsible (native <details>, zero-JS), collapsed by default — a reference list, not the main
  // view — with the count on the summary so you know the history is there without expanding.
  return (
    <details className="group rounded-xl border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 p-4 text-sm font-semibold text-slate-700">
        🧾 Spend activity
        <span className="text-[11px] font-normal text-slate-400">· {items.length} spend{items.length === 1 ? "" : "s"} · newest first</span>
        <svg width="16" height="16" viewBox="0 0 20 20" className="ml-auto shrink-0 text-slate-400 transition-transform group-open:rotate-90" aria-hidden>
          <path fill="currentColor" d="M7 5l6 5-6 5z" />
        </svg>
      </summary>
      <ul className="divide-y divide-slate-100 px-4 pb-2">
        {items.map((it) => (
          <li key={it.id} className="flex items-start gap-2.5 py-2 text-xs">
            <span className="mt-px shrink-0" aria-hidden>🧾</span>
            <div className="min-w-0 flex-1">
              <p className="text-slate-700">
                <span className="font-medium text-slate-900">{it.memberName ?? "Someone"}</span>
                {" — "}
                {it.label}
                <span className="text-slate-400"> · {it.category}</span>
              </p>
              <p className="mt-0.5 text-[10px] tabular-nums text-slate-400">{fmtAt.format(it.at)}</p>
            </div>
            <span className="shrink-0 tabular-nums font-medium text-slate-700">{formatINR(it.amount)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
