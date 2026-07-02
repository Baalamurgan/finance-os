import { redirect } from "next/navigation";
import { loadCommon } from "@/lib/load";
import { setWindDownDay } from "@/app/actions";
import { NavHeader } from "@/components/NavHeader";
import { MonthlySetup } from "@/components/MonthlySetup";

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) redirect("/");
  // Head edits; managers get a read-only view; members are turned away.
  if (!c.canEdit) redirect("/");
  const readOnly = !c.isHead;
  const windDownDay = c.household.windDownDay ?? null;

  // tracked categories carry the recurring config
  const rows = c.categories
    .filter((cat) => cat.tracked)
    .map((cat) => ({
      id: cat.id,
      name: cat.name,
      monthlyBudget: cat.monthlyBudget,
      sinking: cat.sinking,
      cycleMonths: cat.cycleMonths,
      onHold: cat.onHold,
      responsibleMemberId: cat.responsibleMemberId ?? null,
    }));

  return (
    <>
      <NavHeader
        active="setup"
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
      />

      <main className="mx-auto max-w-4xl space-y-5 p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Monthly setup</h1>
          <p className="text-sm text-slate-500">
            Set each category&apos;s recurring monthly budget. New months are pre-filled from
            these (plus a copy of last month&apos;s sheet). Mark **sinking funds** (e.g. WiFi every
            3 months, Mobile every 12) so their monthly share is held separately until the bill is
            due, instead of going to the general Piggy.
          </p>
          {readOnly && (
            <p className="mt-2 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
              You have view-only access. Only the head can change these settings.
            </p>
          )}
        </div>

        {/* Monthly close day — drives the 5-day wind-down reminder banner. */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Wind-down close day</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            The day of the month you aim to close & settle. Everyone sees an in-app reminder in
            the 5 days before it. Leave blank for no reminder.
          </p>
          <form action={setWindDownDay} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">Day (1–28)</span>
              <input
                type="number"
                name="windDownDay"
                min={1}
                max={28}
                defaultValue={windDownDay ?? ""}
                disabled={readOnly}
                placeholder="—"
                className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm shadow-sm disabled:bg-slate-100 disabled:text-slate-400"
              />
            </label>
            {!readOnly && (
              <button
                type="submit"
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Save
              </button>
            )}
          </form>
        </section>

        <MonthlySetup
          rows={rows}
          householdId={c.household.id}
          members={c.members}
          readOnly={readOnly}
        />
      </main>
    </>
  );
}
