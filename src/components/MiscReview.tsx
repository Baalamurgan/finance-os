import { formatINR } from "@/lib/format";
import { moveSpendCategory, ignoreMiscReview } from "@/app/actions";

type Item = { id: number; label: string; amount: number; who: string | null; toId: number; toName: string };

// Head-only safety net: Misc spends whose item looks like a tracked category, each with
// a one-tap "move". Catches what slipped past the entry-time nudge (or another member's
// mistake). Purely corrective — moving updates the spend's category (and its budgets /
// settlement follow, because it really was that category all along).
export function MiscReview({ items }: { items: Item[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-xl border-2 border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-center gap-2">
        <span className="text-lg leading-none">🧹</span>
        <h2 className="text-sm font-bold text-amber-800">
          Review Misc <span className="font-normal text-amber-600">({items.length})</span>
        </h2>
      </div>
      <p className="mt-0.5 text-xs text-amber-700/80">
        These look like they belong in a budgeted category. Move any that are right — or leave
        them if they really are miscellaneous.
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((it) => (
          <li key={it.id} className="rounded-lg border border-amber-200 bg-white px-3 py-2.5">
            {/* the spend: name + amount on one line, who + the suggested category below */}
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 break-words text-sm font-medium text-slate-800">{it.label || "Misc spend"}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{formatINR(it.amount)}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {it.who ? `${it.who} · ` : ""}looks like <span className="font-medium text-amber-700">{it.toName}</span>
            </div>
            {/* actions on their own row — the move button takes the width, so a long category name wraps cleanly */}
            <div className="mt-2 flex items-stretch gap-2">
              <form action={moveSpendCategory} className="min-w-0 flex-1">
                <input type="hidden" name="id" value={it.id} />
                <input type="hidden" name="categoryId" value={it.toId} />
                <button className="h-full w-full rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold leading-snug text-white hover:bg-amber-600 active:bg-amber-700">
                  Move to {it.toName}
                </button>
              </form>
              <form action={ignoreMiscReview} className="shrink-0">
                <input type="hidden" name="id" value={it.id} />
                <button
                  className="h-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 active:bg-slate-100"
                  title="It really is miscellaneous — stop suggesting a move"
                >
                  Keep in Misc
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
