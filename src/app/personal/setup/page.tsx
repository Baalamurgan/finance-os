import { formatINR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { loadPersonal } from "@/lib/loadPersonal";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { PersonalFixedModal } from "@/components/personal/PersonalFixedModal";
import { PersonalFixedRowActions } from "@/components/personal/PersonalFixedRowActions";
import { PersonalSecurity } from "@/components/personal/PersonalSecurity";
import { setPersonalWindDownDay } from "@/app/personal/actions";

export default async function PersonalSetup({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const nav = <PersonalNav active="setup" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} />;

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
                  <span className="text-slate-700">{e.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums font-medium text-slate-800">{formatINR(e.amount)}</span>
                    {c.selected && (
                      <PersonalFixedRowActions
                        periodId={c.selected.id}
                        initial={{ id: e.id, label: e.label, amount: e.amount, recurring: e.recurring }}
                      />
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
          {c.selected && (
            <div className="mt-3">
              <PersonalFixedModal periodId={c.selected.id} defaultRecurring triggerLabel="+ Add standard expense" />
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

        <PersonalSecurity hasBiometric={c.hasBiometric} />
      </main>
    </>
  );
}
