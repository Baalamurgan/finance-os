import { formatINR } from "@/lib/format";
import { moveSpendCategory } from "@/app/actions";

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
          <li key={it.id} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-slate-800">{it.label}</div>
              <div className="text-[11px] text-slate-400">
                {formatINR(it.amount)}{it.who ? ` · ${it.who}` : ""}
              </div>
            </div>
            <form action={moveSpendCategory}>
              <input type="hidden" name="id" value={it.id} />
              <input type="hidden" name="categoryId" value={it.toId} />
              <button className="whitespace-nowrap rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white active:bg-amber-600">
                → {it.toName}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
