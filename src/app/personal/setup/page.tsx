import { formatINR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { loadPersonal } from "@/lib/loadPersonal";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { PersonalFixedModal } from "@/components/personal/PersonalFixedModal";
import { PersonalFixedRowActions } from "@/components/personal/PersonalFixedRowActions";
import { PersonalSecurity } from "@/components/personal/PersonalSecurity";
import { setPersonalWindDownDay, setPersonalCategoryBucket } from "@/app/personal/actions";

const BUCKETS = [
  { key: "need", label: "Need", cls: "bg-emerald-600" },
  { key: "want", label: "Want", cls: "bg-violet-600" },
  { key: "invest", label: "Invest", cls: "bg-amber-500" },
] as const;

export default async function PersonalSetup({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const nav = <PersonalNav active="setup" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} financeDue={c.cardReminders.length > 0} />;

  const catList = c.categories.map((cat) => ({ id: cat.id, name: cat.name, icon: cat.icon }));
  const catName = (id: number | null) => (id == null ? null : c.categories.find((x) => x.id === id));
  const recurring = c.selected
    ? await prisma.personalExpense.findMany({
        where: { periodId: c.selected.id, recurring: true },
        orderBy: { amount: "desc" },
      })
    : [];

  return (
    <>
      {nav}
      <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <h1 className="text-xl font-bold text-slate-900">Personal setup</h1>

        {/* Recurring fixed expenses */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Standard monthly expenses</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Rent, subscriptions, EMIs — these auto-appear on every month&apos;s Sheet. Edit or remove
            any amount; new months copy from the previous one.
          </p>
          <div className="mt-3 divide-y divide-slate-100">
            {recurring.length === 0 ? (
              <p className="py-2 text-sm text-slate-400">None yet.</p>
            ) : (
              recurring.map((e) => (
                <div key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-slate-700">
                    {catName(e.categoryId)?.icon} {e.label}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums font-medium text-slate-800">{formatINR(e.amount)}</span>
                    {c.selected && (
                      <PersonalFixedRowActions
                        periodId={c.selected.id}
                        categories={catList}
                        initial={{ id: e.id, label: e.label, categoryId: e.categoryId, amount: e.amount, recurring: e.recurring }}
                      />
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
          {c.selected && (
            <div className="mt-3">
              <PersonalFixedModal periodId={c.selected.id} categories={catList} defaultRecurring triggerLabel="+ Add standard expense" />
            </div>
          )}
        </section>

        {/* Close day */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Month close day</h2>
          <p className="mt-0.5 text-xs text-slate-500">Your month boundary. Months roll over automatically.</p>
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
            <button className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Save</button>
          </form>
        </section>

        {/* 50/30/20 buckets */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Category buckets (50/30/20)</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Classify each category as a <b>Need</b>, <b>Want</b> or <b>Investment</b> — this drives the
            Analysis tab&apos;s 50/30/20 split.
          </p>
          <div className="mt-3 space-y-2">
            {c.categories.map((cat) => (
              <div key={cat.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-slate-700">
                  {cat.icon} {cat.name}
                </span>
                <form action={setPersonalCategoryBucket} className="flex gap-1">
                  <input type="hidden" name="id" value={cat.id} />
                  {BUCKETS.map((b) => (
                    <button
                      key={b.key}
                      name="bucket"
                      value={b.key}
                      className={`rounded-md px-2 py-1 text-xs font-medium ${
                        cat.bucket === b.key ? `${b.cls} text-white` : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                </form>
              </div>
            ))}
          </div>
        </section>

        <PersonalSecurity hasBiometric={c.hasBiometric} />
      </main>
    </>
  );
}
