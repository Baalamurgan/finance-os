import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { loadCommon } from "@/lib/load";
import { setWindDownDay, createNextMonthDraft, setBillReminders, addMiscCategory, deleteMiscCategory } from "@/app/actions";
import { getSpendShortcuts } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { MonthlySetup } from "@/components/MonthlySetup";
import { RecurringSetup, type RItem, type CatOpt } from "@/components/RecurringSetup";
import { QuickChipsSetup } from "@/components/QuickChipsSetup";

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

  // the current open month — the "this month" anchor for installment display + the bridge label
  const openPeriod = await prisma.period.findFirst({
    where: { householdId: c.household.id, status: "open" },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { label: true, year: true, month: true },
  });

  // The recurring template = the RecurringItem source of truth (edited here → next month).
  const rawItems = await prisma.recurringItem.findMany({
    where: { householdId: c.household.id },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
  });
  const catOf = new Map(c.categories.map((cat) => [cat.id, cat]));
  const memberName = (id: number | null) => (id == null ? null : c.members.find((m) => m.id === id)?.name ?? null);
  const instCurrent = (it: (typeof rawItems)[number]) => {
    if (it.installmentsTotal == null || it.installmentStartYear == null || it.installmentStartMonth == null || !openPeriod) return null;
    return (openPeriod.year - it.installmentStartYear) * 12 + (openPeriod.month - it.installmentStartMonth) + 1;
  };
  const templateItems: RItem[] = rawItems.map((it) => ({
    id: it.id,
    kind: it.kind === "income" ? "income" : "expense",
    name: it.name,
    amount: it.amount,
    categoryId: it.categoryId,
    section: it.categoryId != null ? catOf.get(it.categoryId)?.section ?? "Monthly" : "Monthly",
    memberId: it.memberId,
    memberName: memberName(it.memberId),
    active: it.active,
    installmentsTotal: it.installmentsTotal,
    installmentCurrent: instCurrent(it),
    intervalMonths: it.intervalMonths,
    installmentStartYear: it.installmentStartYear,
    installmentStartMonth: it.installmentStartMonth,
    dueDay: it.dueDay,
  }));
  const categoryOpts: CatOpt[] = c.categories.map((cat) => ({ id: cat.id, name: cat.name, section: cat.section }));

  // Quick-add chips for the Add-Spend modal + the tracked categories they can target.
  const spendShortcuts = await getSpendShortcuts(c.household.id);
  const chipCategoryOpts = c.categories.filter((cat) => cat.tracked).map((cat) => ({ id: cat.id, name: cat.name }));

  // category budgets & sinking-fund template (amounts / cycles / full bills) — edited here
  const rows = c.categories
    .filter((cat) => cat.tracked || cat.fixed || cat.billEveryMonths != null || cat.fundingStyle != null)
    .map((cat) => ({
      id: cat.id, name: cat.name, section: cat.section, monthlyBudget: cat.monthlyBudget,
      sinking: cat.sinking, cycleMonths: cat.cycleMonths, onHold: cat.onHold, fixed: cat.fixed, remind: cat.remind, reminderDays: cat.reminderDays,
      responsibleMemberId: cat.responsibleMemberId ?? null, payerMemberId: cat.payerMemberId ?? null,
      billEveryMonths: cat.billEveryMonths, billMonth: cat.billMonth, billDay: cat.billDay, billAmount: cat.billAmount,
      fundingStyle: cat.fundingStyle, saveEveryMonths: cat.saveEveryMonths, onUnpaid: cat.onUnpaid, needsReview: cat.needsReview,
      isAllowance: cat.isAllowance,
    }));

  return (
    <>
      <NavHeader
        active="setup"
        householdName={c.household.name}
        miscSubCategories={c.miscSubCategories}
        selYear={c.selYear}
        selMonth={c.selMonth}
        previewPeriod={c.previewPeriod}
        provisional={c.provisional}
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
            The recurring template — the single source of truth. Every month is generated from these
            items. Add, edit amounts, pause or delete here; <b>changes apply from next month</b> and the
            current sheet stays frozen.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            📌 A value you edit directly on a month&apos;s Sheet is <b>kept</b> for that month — a
            &ldquo;Sync from Setup&rdquo; leaves it alone (use the ↻ on the line to re-pull it here).
          </p>
          {readOnly && (
            <p className="mt-2 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
              View-only access. Only the head can change these settings.
            </p>
          )}
        </div>

        <RecurringSetup
          items={templateItems}
          categories={categoryOpts}
          members={c.members.map((m) => ({ id: m.id, name: m.name }))}
          householdId={c.household.id}
          readOnly={readOnly}
        />

        {/* Edit next month: add / change amounts / remove — on the draft, so this
            month stays frozen. The draft is a full editable sheet. */}
        {!readOnly && openPeriod && (
          <section className="rounded-xl border border-violet-200 bg-violet-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-violet-800">✏️ Add / edit next month</h2>
                <p className="mt-0.5 text-xs text-violet-700/80">
                  Add a new income/expense, change an amount, or remove a line for <b>next month</b> —
                  it opens next month&apos;s draft (a full editable sheet). This month stays frozen.
                </p>
              </div>
              <form action={createNextMonthDraft}>
                <input type="hidden" name="householdId" value={c.household.id} />
                <button className="whitespace-nowrap rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700">
                  Plan next month →
                </button>
              </form>
            </div>
          </section>
        )}

        {/* quick-add chips for the Add-Spend modal */}
        <QuickChipsSetup shortcuts={spendShortcuts} categories={chipCategoryOpts} readOnly={readOnly} />

        {/* Head-editable tags for Personal/Misc spends — drive the picker & the expenses donut.
            Reporting-only: they never touch settlement or budgets. */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Miscellaneous spend categories</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            The tags shown when logging a Personal/Misc spend, and the slices in the Expenses donut.
            Add or remove them freely — it&apos;s labelling only and never changes any amount.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {c.miscSubCategories.map((cat) => (
              <span key={cat.name} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-2.5 pr-1 text-sm text-slate-700">
                <span>{cat.icon} {cat.name}</span>
                {!readOnly && (
                  <form action={deleteMiscCategory}>
                    <input type="hidden" name="name" value={cat.name} />
                    <button type="submit" aria-label={`Remove ${cat.name}`} className="flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:bg-red-100 hover:text-red-600">✕</button>
                  </form>
                )}
              </span>
            ))}
          </div>
          {!readOnly && (
            <form action={addMiscCategory} className="mt-3 flex flex-wrap items-center gap-2">
              <input name="icon" maxLength={2} placeholder="🔖" aria-label="Emoji" className="w-14 rounded-md border border-slate-300 px-2 py-1.5 text-center text-sm" />
              <input name="name" required maxLength={40} placeholder="New category name" className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
              <button type="submit" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">Add</button>
            </form>
          )}
        </section>

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

        {/* Master switch for the 3-day-before bill-due popups. Per-bill mute lives on each
            bill row above (the 🔔 next to its On/Off toggle). */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Bill-due reminders</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                A high-priority popup 3 days before each bill&apos;s due date, then daily until it&apos;s
                marked paid — shown to the responsible member, the head, and managers. Mute individual
                bills with the 🔔 on each row above.
              </p>
            </div>
            <form action={setBillReminders} className="shrink-0">
              <input type="hidden" name="on" value={c.household.billRemindersOn ? "" : "on"} />
              <button
                type="submit"
                disabled={readOnly}
                aria-pressed={c.household.billRemindersOn}
                title={c.household.billRemindersOn ? "On — tap to turn all reminders off" : "Off — tap to turn reminders on"}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${c.household.billRemindersOn ? "bg-indigo-600" : "bg-slate-300"}`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${c.household.billRemindersOn ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </form>
          </div>
        </section>
      </main>
    </>
  );
}
