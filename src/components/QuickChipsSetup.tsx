import { createSpendShortcut, updateSpendShortcut, deleteSpendShortcut, moveSpendShortcut } from "@/app/actions";

type Shortcut = { id: number; icon: string | null; label: string; categoryId: number; categoryName: string };
type Cat = { id: number; name: string };

// Head/manager-curated "quick add" chips shown in the Add-Spend modal. Server component:
// each row is one form with several formAction buttons (save / delete / reorder), so no
// client JS is needed. If none are set up, the modal falls back to the family's most
// frequent items automatically.
export function QuickChipsSetup({
  shortcuts,
  categories,
  readOnly,
}: {
  shortcuts: Shortcut[];
  categories: Cat[];
  readOnly: boolean;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">🧷 Quick-add chips</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        One-tap buttons at the top of <b>Add Spend</b>. Add the items you buy often (e.g. a chip
        <b> Maavu → Veg &amp; Fruits</b>) so they fill the item and the right category in one tap — and
        never land in Misc. No chips yet? Add Spend shows your most-frequent items automatically.
      </p>

      {/* existing chips */}
      <ul className="mt-3 divide-y divide-slate-100">
        {shortcuts.map((s, i) => (
          <li key={s.id} className="py-2.5">
            <form className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={s.id} />
              <input
                name="icon"
                defaultValue={s.icon ?? ""}
                maxLength={2}
                placeholder="🔖"
                disabled={readOnly}
                className="w-12 rounded-md border border-slate-300 px-2 py-1.5 text-center text-base disabled:bg-slate-50"
              />
              <input
                name="label"
                defaultValue={s.label}
                placeholder="Item (e.g. Maavu)"
                disabled={readOnly}
                className="min-w-28 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
              />
              <span className="text-slate-400">→</span>
              <select
                name="categoryId"
                defaultValue={s.categoryId}
                disabled={readOnly}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {!readOnly && (
                <div className="ml-auto flex items-center gap-1">
                  <button
                    formAction={moveSpendShortcut}
                    name="dir"
                    value="up"
                    formNoValidate
                    disabled={i === 0}
                    className="rounded-md px-2 py-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    formAction={moveSpendShortcut}
                    name="dir"
                    value="down"
                    formNoValidate
                    disabled={i === shortcuts.length - 1}
                    className="rounded-md px-2 py-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    formAction={updateSpendShortcut}
                    className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
                  >
                    Save
                  </button>
                  <button
                    formAction={deleteSpendShortcut}
                    formNoValidate
                    className="rounded-md px-2 py-1.5 text-slate-300 hover:text-red-600"
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              )}
            </form>
          </li>
        ))}
        {shortcuts.length === 0 && (
          <li className="py-3 text-center text-sm text-slate-400">
            No chips yet — Add Spend shows your most-frequent items until you add some.
          </li>
        )}
      </ul>

      {/* add a chip */}
      {!readOnly && (
        <form action={createSpendShortcut} className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <input name="icon" maxLength={2} placeholder="🔖" className="w-12 rounded-md border border-slate-300 px-2 py-2 text-center text-base" />
          <input name="label" required placeholder="New item (e.g. Milk)" className="min-w-28 flex-1 rounded-md border border-slate-300 px-2 py-2 text-sm" />
          <span className="text-slate-400">→</span>
          <select name="categoryId" required defaultValue="" className="rounded-md border border-slate-300 px-2 py-2 text-sm">
            <option value="" disabled>Category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            + Add chip
          </button>
        </form>
      )}
    </section>
  );
}
