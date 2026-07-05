import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { loadCommon } from "@/lib/load";
import { setWindDownDay } from "@/app/actions";
import { NavHeader } from "@/components/NavHeader";
import { MonthlySetup } from "@/components/MonthlySetup";
import { RecurringSetup, type IncomeLine, type ExpenseLine } from "@/components/RecurringSetup";

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

  // The recurring template = the current OPEN month's lines (never a draft).
  const openPeriod = await prisma.period.findFirst({
    where: { householdId: c.household.id, status: "open" },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  const prevM = openPeriod ? (openPeriod.month === 1 ? 12 : openPeriod.month - 1) : 0;
  const prevY = openPeriod ? (openPeriod.month === 1 ? openPeriod.year - 1 : openPeriod.year) : 0;
  const prev = openPeriod
    ? await prisma.period.findUnique({ where: { householdId_year_month: { householdId: c.household.id, year: prevY, month: prevM } } })
    : null;

  const [incomes, expenses, prevInc, prevExp] = await Promise.all([
    openPeriod ? prisma.incomeEntry.findMany({ where: { periodId: openPeriod.id }, include: { owner: true }, orderBy: { amount: "desc" } }) : [],
    openPeriod ? prisma.expenseEntry.findMany({ where: { periodId: openPeriod.id }, include: { category: true, member: true }, orderBy: { amount: "desc" } }) : [],
    prev ? prisma.incomeEntry.findMany({ where: { periodId: prev.id }, select: { source: true } }) : [],
    prev ? prisma.expenseEntry.findMany({ where: { periodId: prev.id }, select: { label: true } }) : [],
  ]);
  const prevIncSrc = new Set(prevInc.map((i) => i.source));
  const prevExpLbl = new Set(prevExp.map((e) => e.label));

  const incomeLines: IncomeLine[] = incomes.map((i) => ({
    id: i.id, name: i.source, amount: i.amount, member: i.owner?.name ?? null,
    repeats: !i.oneOff, isNew: !!prev && !prevIncSrc.has(i.source),
  }));
  const expenseLines: ExpenseLine[] = expenses.map((e) => {
    const isSetupCat = e.category?.monthlyBudget != null; // template-driven → repeat = category onHold
    return {
      id: e.id, name: e.label, amount: e.amount, section: e.category?.section ?? "Monthly",
      member: e.member?.name ?? null,
      repeats: isSetupCat ? !e.category!.onHold : !e.oneOff,
      isNew: !!prev && !prevExpLbl.has(e.label),
      toggleKind: isSetupCat ? "category" : "expense",
      targetId: isSetupCat ? e.categoryId : e.id,
    };
  });

  // category budgets & sinking-fund template (amounts / cycles) — edited here
  const rows = c.categories
    .filter((cat) => cat.tracked || cat.fixed)
    .map((cat) => ({
      id: cat.id, name: cat.name, section: cat.section, monthlyBudget: cat.monthlyBudget,
      sinking: cat.sinking, cycleMonths: cat.cycleMonths, onHold: cat.onHold, fixed: cat.fixed,
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
        pinEnabled={c.pinEnabled}
        hasBiometric={c.hasBiometric}
        actualIsHead={c.actualIsHead}
        viewingAsMember={c.viewingAsMember}
      />

      <main className="mx-auto max-w-4xl space-y-5 p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Setup</h1>
          <p className="text-sm text-slate-500">
            Control what repeats into next month — from {openPeriod?.label ?? "the current month"}. Anything
            you turn off stays one-off and won&apos;t copy forward (or into the next-month preview).
            Edit the actual amounts on the Sheet.
          </p>
          {readOnly && (
            <p className="mt-2 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
              View-only access. Only the head can change these settings.
            </p>
          )}
        </div>

        {openPeriod ? (
          <RecurringSetup income={incomeLines} expenses={expenseLines} readOnly={readOnly} />
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            No open month yet — start one on the Sheet tab first.
          </p>
        )}

        {/* category budgets & sinking-fund template */}
        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="text-sm font-semibold text-slate-900">⚙️ Budgets &amp; sinking funds</span>
            <span className="text-xs text-slate-400">amounts, sinking cycles, who&apos;s responsible</span>
          </summary>
          <div className="border-t border-slate-100 p-4">
            <MonthlySetup rows={rows} householdId={c.household.id} members={c.members} readOnly={readOnly} />
          </div>
        </details>

        {/* Monthly close day — drives the 5-day wind-down reminder banner. */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Wind-down close day</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            The day of the month you aim to close &amp; settle. Everyone sees an in-app reminder in the 5
            days before it. Leave blank for no reminder.
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
              <button type="submit" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
                Save
              </button>
            )}
          </form>
        </section>
      </main>
    </>
  );
}
