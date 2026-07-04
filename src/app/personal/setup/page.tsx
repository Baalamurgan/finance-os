import { formatINR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { loadPersonal } from "@/lib/loadPersonal";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { PersonalExpenseModal } from "@/components/personal/PersonalExpenseModal";
import { PersonalSecurity } from "@/components/personal/PersonalSecurity";
import {
  addPersonalCategory,
  archivePersonalCategory,
  deletePersonalExpense,
  setPersonalWindDownDay,
} from "@/app/personal/actions";

export default async function PersonalSetup({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const nav = <PersonalNav active="setup" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} />;

  const catList = c.categories.map((cat) => ({ id: cat.id, name: cat.name, icon: cat.icon }));
  const recurring = c.selected
    ? await prisma.personalExpense.findMany({
        where: { periodId: c.selected.id, recurring: true },
        orderBy: { amount: "desc" },
      })
    : [];
  const catName = (id: number) => c.categories.find((x) => x.id === id);

  return (
    <>
      {nav}
      <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <h1 className="text-xl font-bold text-slate-900">Personal setup</h1>

        {/* Recurring monthly expenses */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Standard monthly expenses</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            These auto-appear on every month&apos;s sheet (rent, subscriptions…). Changes apply to this
            month; new months copy from the previous one.
          </p>
          <div className="mt-3 divide-y divide-slate-100">
            {recurring.length === 0 ? (
              <p className="py-2 text-sm text-slate-400">None yet.</p>
            ) : (
              recurring.map((e) => {
                const cat = catName(e.categoryId);
                return (
                  <div key={e.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-slate-700">
                      {cat?.icon} {cat?.name}
                      {e.note ? ` · ${e.note}` : ""}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums font-medium text-slate-800">{formatINR(e.amount)}</span>
                      <form action={deletePersonalExpense}>
                        <input type="hidden" name="id" value={e.id} />
                        <button className="text-xs text-slate-400 hover:text-red-600">Remove</button>
                      </form>
                    </span>
                  </div>
                );
              })
            )}
          </div>
          {c.selected && (
            <div className="mt-3">
              <PersonalExpenseModal
                periodId={c.selected.id}
                categories={catList}
                defaultRecurring
                triggerLabel="+ Add recurring expense"
              />
            </div>
          )}
        </section>

        {/* Close day */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Month close day</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            The day you think of as your month boundary. Months roll over automatically.
          </p>
          <form action={setPersonalWindDownDay} className="mt-3 flex items-end gap-2">
            <input
              type="number"
              name="windDownDay"
              min={1}
              max={28}
              defaultValue={c.member.personalWindDownDay ?? ""}
              placeholder="—"
              className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm shadow-sm"
            />
            <button className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
              Save
            </button>
          </form>
        </section>

        {/* Categories */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Categories</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {c.categories.map((cat) => (
              <form key={cat.id} action={archivePersonalCategory}>
                <input type="hidden" name="id" value={cat.id} />
                <button
                  className="flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
                  title="Archive"
                >
                  {cat.icon} {cat.name} <span className="text-slate-300">×</span>
                </button>
              </form>
            ))}
          </div>
          <form action={addPersonalCategory} className="mt-3 flex gap-2">
            <input name="icon" placeholder="🔖" maxLength={2} className="input w-14 text-center" />
            <input name="name" placeholder="New category" className="input flex-1" required />
            <button className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900">Add</button>
          </form>
        </section>

        <PersonalSecurity hasBiometric={c.hasBiometric} />
      </main>
    </>
  );
}
