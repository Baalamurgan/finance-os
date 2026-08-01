import { redirect } from "next/navigation";
import { formatINR } from "@/lib/format";
import { categoryEmoji } from "@/lib/categoryEmoji";
import { loadCommon } from "@/lib/load";
import { getRollup, getWindDownPreview, getSkippedSetAsides } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { RowActions } from "@/components/RowActions";
import { ExpenseRowActions } from "@/components/ExpenseRowActions";
import { ExpenseModal } from "@/components/ExpenseModal";
import { DetailsPersist } from "@/components/DetailsPersist";
import { IncomeModal } from "@/components/IncomeModal";
import { IncomeRowActions } from "@/components/IncomeRowActions";
import { MoneyFlowDonut } from "@/components/Charts";
import { ConfirmForm } from "@/components/ConfirmForm";
import { SheetLockNotice } from "@/components/SheetLockNotice";
import { RebuildDraftButton } from "@/components/RebuildDraftButton";
import { monthsUntilNextDue } from "@/lib/schedule";
import { createPeriod, deleteIncome, createNextMonthDraft, discardDraft, skipSetAside, restoreSetAside } from "./actions";

const SECTION_COLOR: Record<string, string> = {
  Loans: "#ef4444",
  Chits: "#f59e0b",
  Monthly: "#6366f1",
  PiggyBudget: "#0ea5e9",
  Yearly: "#14b8a6",
  Misc: "#a855f7",
};

const SECTION_ORDER = ["Loans", "Chits", "Monthly", "PiggyBudget", "Yearly", "Misc"] as const;
const SECTION_LABEL: Record<string, string> = {
  Loans: "Loans",
  Chits: "Chits",
  Monthly: "Monthly Expense",
  PiggyBudget: "Budgeted · leftover → Piggy",
  Yearly: "Yearly / Periodic bills",
  Misc: "Miscellaneous",
};

// A tracked monthly budget whose unspent leftover rolls into the general Piggy — a
// "sinking-fund-like" envelope. These are grouped apart from flat fixed bills so you can
// see at a glance what's budgeted (and would accrue to Piggy if unused).
function isPiggyBudget(cat: ExpRow["category"]): boolean {
  return (
    cat.section === "Monthly" &&
    cat.tracked &&
    !cat.sinking &&
    cat.fundingStyle == null &&
    (cat.billEveryMonths == null || cat.billEveryMonths <= 1)
  );
}

// Which Sheet section an expense line DISPLAYS under (independent of its category's tab):
// every line of a periodic bill — its set-aside/share, the due-month bill, the fund credit —
// sits together under Yearly / periodic bills; tracked leftover→Piggy budgets get their own
// section; everything else follows its category's section.
function sheetSection(e: ExpRow): string {
  if (e.category.billEveryMonths != null && e.category.billEveryMonths > 1) return "Yearly";
  if (isPiggyBudget(e.category)) return "PiggyBudget";
  return e.category.section;
}

function monthLabel(month: number, year: number) {
  return `${new Date(year, month - 1, 1)
    .toLocaleString("en-US", { month: "short" })
    .toUpperCase()} ${year}`;
}

type ExpRow = Awaited<ReturnType<typeof getRollup>>["expenses"][number];
type CatLite = { id: number; name: string; section?: string };
type MemLite = { id: number; name: string };

function ExpenseRow({
  e,
  canEditHere,
  categories,
  members,
  periodId,
  periodMonth,
}: {
  e: ExpRow;
  canEditHere: boolean;
  categories: CatLite[];
  members: MemLite[];
  periodId: number;
  periodMonth: number;
}) {
  const isSetAside =
    e.category.fundingStyle != null &&
    (e.label.endsWith("(saving)") || e.label.endsWith("(monthly share)"));
  // Removing this set-aside frees e.amount now; the remaining cadence saves rise to keep the
  // fund on track. saves-left this month = months-until-due ÷ cadence; after removing one,
  // each remaining share ≈ current × savesLeft/(savesLeft−1). savesLeft 1 → last save → the
  // shortfall lands out-of-pocket at the due month.
  const savesLeft =
    isSetAside && e.category.billMonth != null && e.category.billEveryMonths != null
      ? monthsUntilNextDue(e.category.billMonth, e.category.billEveryMonths, periodMonth) / Math.max(1, e.category.saveEveryMonths ?? 1) + 1 // +1 = the due month's own share
      : 0;
  const newShare = savesLeft > 1 ? Math.round(((e.amount * savesLeft) / (savesLeft - 1)) * 100) / 100 : null;
  // A flat monthly bill (billEveryMonths === 1, e.g. a subscription) is independent each month:
  // skipping just means "don't pay this one month"; next month is a fresh, unchanged share — no
  // re-spread. Only a multi-month sinking bill needs the "remaining shares rise" warning.
  const isFlatMonthly = e.category.billEveryMonths === 1;
  const removeMsg = isFlatMonthly
    ? `Skip this month's payment for “${e.category.name}”?\n\n` +
      `You just won't pay it this month — next month is a fresh ${formatINR(e.amount)}, nothing re-spreads.` +
      `\n\nIt won't come back on a rebuild; Setup stays the template.`
    : `Remove this month's set-aside for “${e.category.name}”?\n\n` +
      `Frees ${formatINR(e.amount)} now. ` +
      (newShare != null
        ? `The remaining months' share rises to about ${formatINR(newShare)} to keep the fund on track for the due month.`
        : `This was the last set-aside before the bill — the shortfall will be paid out-of-pocket on the due month.`) +
      `\n\nIt won't come back on a rebuild; Setup stays the template.`;
  return (
    <Row label={e.label} sub={e.category.name} emoji={categoryEmoji(e.category.name)} tag={e.member?.name} amount={e.amount}>
      {canEditHere && isSetAside && (
        <ConfirmForm action={skipSetAside} message={removeMsg}>
          <input type="hidden" name="categoryId" value={e.categoryId} />
          <input type="hidden" name="periodId" value={periodId} />
          <button className="rounded-md px-2 py-1 text-[11px] font-medium text-amber-600 hover:bg-amber-50" title={isFlatMonthly ? "Skip this month's payment — next month is unchanged" : "Remove this month's set-aside — frees the money now; the remaining months' share rises"}>
            {isFlatMonthly ? "skip this month" : "remove"}
          </button>
        </ConfirmForm>
      )}
      {canEditHere && !isSetAside && (
        <ExpenseRowActions
          categories={categories}
          members={members}
          periodId={periodId}
          initial={{
            id: e.id,
            label: e.label,
            amount: e.amount,
            categoryId: e.categoryId,
            memberId: e.memberId,
            necessary: e.necessary,
          }}
        />
      )}
    </Row>
  );
}

function ExpenseSection({
  g,
  canEditHere,
  categories,
  members,
  periodId,
  periodMonth,
}: {
  g: { section: string; rows: ExpRow[]; subtotal: number };
  canEditHere: boolean;
  categories: CatLite[];
  members: MemLite[];
  periodId: number;
  periodMonth: number;
}) {
  return (
    <details data-persist={`sec-${g.section}`} className="group border-b border-slate-100 last:border-0">
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2 py-2 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 20 20" className="text-slate-400 transition-transform group-open:rotate-90">
            <path fill="currentColor" d="M7 5l6 5-6 5z" />
          </svg>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {SECTION_LABEL[g.section]}
          </span>
          <span className="text-[10px] text-slate-400">({g.rows.length})</span>
        </span>
        <span className="text-sm font-bold tabular-nums text-slate-700">{formatINR(g.subtotal)}</span>
      </summary>
      <div className="divide-y divide-slate-100 px-2 pb-1">
        {g.rows.map((e) => (
          <ExpenseRow
            key={e.id}
            e={e}
            canEditHere={canEditHere}
            categories={categories}
            members={members}
            periodId={periodId}
            periodMonth={periodMonth}
          />
        ))}
      </div>
    </details>
  );
}

export default async function SheetPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return <SeedNotice />;

  // Next-month preview draft: everyone can view; only head + manager can edit it.
  const isDraft = c.selected?.status === "draft";
  const draftPeriod = c.periods.find((p) => p.status === "draft") ?? null;

  const nav = (
    <NavHeader
      active="sheet"
      householdName={c.household.name}
      selYear={c.selYear}
      selMonth={c.selMonth}
      previewPeriod={c.previewPeriod}
      provisional={c.provisional}
      members={c.members}      categories={c.categories}
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
  );

  // no period for the chosen month/year
  if (c.noData || !c.selected) {
    return (
      <>
        {nav}
        <main className="mx-auto max-w-2xl p-16 text-center">
          <div className="text-5xl">📭</div>
          <h1 className="mt-3 text-lg font-semibold text-slate-800">
            No data for {monthLabel(c.selMonth, c.selYear)}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Nothing has been recorded for this month yet.
          </p>
          {c.isHead && (
            <form action={createPeriod} className="mt-6">
              <input type="hidden" name="householdId" value={c.household.id} />
              <input type="hidden" name="year" value={c.selYear} />
              <input type="hidden" name="month" value={c.selMonth} />
              <button className="btn">Start {monthLabel(c.selMonth, c.selYear)}</button>
            </form>
          )}
        </main>
      </>
    );
  }

  const rollup = await getRollup(c.selected.id);
  const skipped = await getSkippedSetAsides(c.household.id, c.selected.id);
  const open = c.selected.status === "open";

  // Draft estimate: what the current open month will carry in + leave in Piggy.
  const draftSource = isDraft ? c.periods.find((p) => p.status === "open") ?? null : null;
  const preview = draftSource ? await getWindDownPreview(c.household.id, draftSource.id) : null;

  // Safeguard: if the current calendar month has no period yet (e.g. the monthly
  // auto-create didn't run), nudge the head to start it so the family always has
  // an open month to log into.
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const currentMonthMissing = !c.periods.some((p) => p.year === curY && p.month === curM);

  // A draft that IS the current calendar month (e.g. Aug's preview being viewed on/after
  // Aug 1, before Jul is wound down): it's no longer "next month" — it's this month, still
  // a preview until the previous month closes. Reword the banner accordingly.
  const draftIsThisMonth = isDraft && c.selected.year === curY && c.selected.month === curM;

  // Head + Manager edit open months and the next-month draft; the head can also
  // edit a closed (locked) month. Plain members are view-only everywhere.
  // Settlement lock: once a transfer is marked paid, the sheet freezes for non-heads
  // (the head can still edit; daily spends still flow on the Expenses tab).
  const sheetLocked = c.locked && !c.isHead;
  const canEditHere = c.canEdit && (open || c.isHead || isDraft) && !sheetLocked;
  const editingClosed = canEditHere && !open && !isDraft; // head editing a locked month

  // group expenses by their DISPLAY section (sheetSection: shares → Monthly, periodic
  // bills → Yearly) in the fixed section order
  const grouped = SECTION_ORDER.map((section) => {
    const rows = rollup.expenses.filter((e) => sheetSection(e) === section);
    return { section, rows, subtotal: rows.reduce((s, e) => s + e.amount, 0) };
  }).filter((g) => g.rows.length > 0);

  // split the Expense column into blocks: fixed monthly (Loans+Chits+Monthly), the
  // always-shown Yearly/periodic-bills block, and miscellaneous/extra (Misc).
  const FIXED_SECTIONS = ["Loans", "Chits", "Monthly", "PiggyBudget"];
  const fixedGroups = grouped.filter((g) => FIXED_SECTIONS.includes(g.section));
  const yearlyRows = rollup.expenses.filter((e) => sheetSection(e) === "Yearly");
  const yearlySubtotal = yearlyRows.reduce((s, e) => s + e.amount, 0);
  // Misc / extra shown newest-first (carried lines + ad-hoc adds) — most recent on top.
  const miscRows = rollup.expenses
    .filter((e) => sheetSection(e) === "Misc")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id);
  const fixedSubtotal = fixedGroups.reduce((s, g) => s + g.subtotal, 0);
  const miscSubtotal = miscRows.reduce((s, e) => s + e.amount, 0);
  const fixedCats = c.categories.filter((cat) => FIXED_SECTIONS.includes(cat.section));
  const yearlyCats = c.categories.filter((cat) => cat.section === "Yearly" || (cat.billEveryMonths != null && cat.billEveryMonths > 1));
  const miscCats = c.categories.filter((cat) => cat.section === "Misc");

  return (
    <>
      {nav}
      <DetailsPersist />
      <main className="mx-auto max-w-[68rem] space-y-4 p-6">
        {/* Next-month preview draft — head-only, distinct from real months */}
        {isDraft && (
          <div className="rounded-xl border-2 border-dashed border-violet-300 bg-violet-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg">🔮</span>
                  <h2 className="font-bold text-violet-800">
                    {draftIsThisMonth ? `Preview — ${c.selected.label}` : `Next-month draft — ${c.selected.label}`}
                  </h2>
                  <span className="rounded-full bg-violet-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
                    {draftIsThisMonth ? "Preview" : "Draft"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-violet-700/80">
                  {draftIsThisMonth ? (
                    <>
                      This is <b>{c.selected.label}</b> — shown as a preview until{" "}
                      {draftSource?.label ?? "the previous month"} is wound down, when it becomes your
                      live month. {canEditHere ? "Edits here won't affect that wind-down." : ""}
                    </>
                  ) : canEditHere ? (
                    <>
                      A preview you can edit freely — add, remove, change amounts. It{" "}
                      <b>won&apos;t affect {draftSource?.label ?? "this month"}&apos;s wind-down</b>; it
                      becomes the real month when {draftSource?.label ?? "the current month"} closes.
                    </>
                  ) : (
                    <>
                      A preview of next month. It becomes the real month when{" "}
                      {draftSource?.label ?? "the current month"} closes. <b>View only</b> — the head or a
                      manager makes changes.
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a href="/" className="rounded-md border border-violet-300 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100">
                  ← Back to {draftSource?.label ?? "now"}
                </a>
                {canEditHere && (
                  <>
                    <RebuildDraftButton periodId={c.selected.id} />
                    <ConfirmForm action={discardDraft} message="Discard this next-month draft? You can preview again anytime.">
                      <input type="hidden" name="periodId" value={c.selected.id} />
                      <button className="rounded-md px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">Discard</button>
                    </ConfirmForm>
                  </>
                )}
              </div>
            </div>
            {preview && (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-white/70 p-2.5">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-violet-500">
                    {preview.carryOut >= 0 ? `Last month surplus → income` : `Carried-in shortfall`}
                  </div>
                  <div className={`text-base font-bold tabular-nums ${preview.carryOut < 0 ? "text-red-600" : "text-violet-900"}`}>
                    {formatINR(preview.carryOut)}
                  </div>
                </div>
                <div className="rounded-lg bg-white/70 p-2.5">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-violet-500">
                    🐷 Piggy after {preview.label} closes
                  </div>
                  <div className="text-base font-bold tabular-nums text-violet-900">{formatINR(preview.piggyAfter)}</div>
                </div>
                <div className="rounded-lg bg-white/70 p-2.5">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-violet-500">
                    Misc carried in (from {preview.label})
                  </div>
                  <div className="text-base font-bold tabular-nums text-violet-900">{formatINR(preview.carried)}</div>
                </div>
              </div>
            )}
            <p className="mt-2 text-[10px] text-violet-600/70">
              Estimates — final figures are set when you wind down {preview?.label ?? "the current month"}.
            </p>
          </div>
        )}

        {c.isHead && currentMonthMissing && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-medium text-amber-800">
              {monthLabel(curM, curY)} hasn&apos;t been started yet — the family can&apos;t log
              spends until it&apos;s open.
            </p>
            <form action={createPeriod}>
              <input type="hidden" name="householdId" value={c.household.id} />
              <input type="hidden" name="year" value={curY} />
              <input type="hidden" name="month" value={curM} />
              <button className="btn whitespace-nowrap">Start {monthLabel(curM, curY)}</button>
            </form>
          </div>
        )}

        {editingClosed && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800">
            🔒 {c.selected.label} is closed — you&apos;re editing a locked month as head. Changes save immediately.
          </div>
        )}

        {c.locked && !isDraft && (
          <SheetLockNotice isHead={c.isHead} y={c.selYear} m={c.selMonth} />
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-slate-900">{c.selected.label} roll-up</h1>
          <div className="flex items-center gap-2 text-sm">
            {c.selected.carryForward !== 0 && (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                Carried in: {formatINR(c.selected.carryForward)}
              </span>
            )}
            <a
              href={`/api/export?y=${c.selYear}&m=${c.selMonth}`}
              className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              ↓ Export CSV
            </a>
            {c.canEdit && open && !isDraft && !c.provisional && (
              <form action={createNextMonthDraft}>
                <input type="hidden" name="householdId" value={c.household.id} />
                <button className="rounded-full border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100">
                  🔮 Preview next month →
                </button>
              </form>
            )}
            {!c.canEdit && open && !isDraft && !c.provisional && draftPeriod && (
              <a
                href={`/?y=${draftPeriod.year}&m=${draftPeriod.month}`}
                className="rounded-full border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
              >
                🔮 View next month →
              </a>
            )}
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                isDraft ? "bg-violet-100 text-violet-700" : open ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"
              }`}
            >
              {isDraft ? "Draft" : open ? "Open" : "Closed"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          {/* INCOME — collapsible column; total shown in the green summary bar */}
          <details data-persist="income" className="group/inc min-w-0 rounded-xl border border-green-200 bg-white">
            <summary className="sticky top-14 z-20 flex cursor-pointer list-none items-center justify-between border-l-4 border-green-500 bg-green-50 px-4 py-3 [&::-webkit-details-marker]:hidden sm:static">
              <span className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 20 20" className="text-green-600 transition-transform group-open/inc:rotate-90">
                  <path fill="currentColor" d="M7 5l6 5-6 5z" />
                </svg>
                <span className="text-sm font-bold uppercase tracking-widest text-green-700">Income</span>
              </span>
              <span className="text-xl font-extrabold tabular-nums text-green-700">
                {formatINR(rollup.totalIncome)}
              </span>
            </summary>
            <div className="divide-y divide-slate-100 px-4 py-1">
              {rollup.incomes.map((i) => (
                <Row key={i.id} label={i.source} tag={i.owner?.name} amount={i.amount}>
                  {c.isHead ? (
                    <IncomeRowActions
                      members={c.members}
                      periodId={c.selected!.id}
                      initial={{ id: i.id, source: i.source, amount: i.amount, ownerId: i.ownerId }}
                    />
                  ) : (
                    canEditHere && <RowActions id={i.id} deleteAction={deleteIncome} />
                  )}
                </Row>
              ))}
              {canEditHere && (
                <div className="py-2">
                  <IncomeModal members={c.members} periodId={c.selected.id} />
                </div>
              )}
            </div>
          </details>

          {/* EXPENSE — collapsible column; total in the red summary bar; split into Fixed vs Misc */}
          <details data-persist="expense" className="group/exp min-w-0 rounded-xl border border-red-200 bg-white">
            <summary className="sticky top-14 z-20 flex cursor-pointer list-none items-center justify-between border-l-4 border-red-500 bg-red-50 px-4 py-3 [&::-webkit-details-marker]:hidden sm:static">
              <span className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 20 20" className="text-red-600 transition-transform group-open/exp:rotate-90">
                  <path fill="currentColor" d="M7 5l6 5-6 5z" />
                </svg>
                <span className="text-sm font-bold uppercase tracking-widest text-red-700">Expense</span>
              </span>
              <span className="text-xl font-extrabold tabular-nums text-red-700">
                {formatINR(rollup.totalExpense)}
              </span>
            </summary>
            <div className="px-2 py-1">
              {/* Fixed monthly (Loans + Chits + Monthly) — collapsible */}
              <details open data-persist="fixed" className="group/fx border-b border-slate-100">
                <summary className="sticky top-[6.5rem] z-10 flex cursor-pointer list-none items-center justify-between rounded-lg bg-white px-2 py-2 hover:bg-slate-50 [&::-webkit-details-marker]:hidden sm:static">
                  <span className="flex items-center gap-1.5">
                    <svg width="14" height="14" viewBox="0 0 20 20" className="text-slate-400 transition-transform group-open/fx:rotate-90">
                      <path fill="currentColor" d="M7 5l6 5-6 5z" />
                    </svg>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Fixed monthly
                    </span>
                  </span>
                  <span className="text-sm font-bold tabular-nums text-slate-700">
                    {formatINR(fixedSubtotal)}
                  </span>
                </summary>
                <div className="pl-3">
                  {fixedGroups.map((g) => (
                    <ExpenseSection
                      key={g.section}
                      g={g}
                      canEditHere={canEditHere}
                      categories={c.categories}
                      members={c.members}
                      periodId={c.selected!.id}
                      periodMonth={c.selected!.month}
                    />
                  ))}
                  {canEditHere && (
                    <div className="px-2 py-2">
                      <ExpenseModal
                        categories={fixedCats}
                        members={c.members}
                        periodId={c.selected!.id}
                        trigger="sheet"
                        balance={rollup.balance}
                        sheetLabel="+ Add fixed expense"
                        newCategoryDefaultSection="Monthly"
                      />
                    </div>
                  )}
                </div>
              </details>

              {/* Yearly / periodic bills — always shown, even when nothing is due this month */}
              <details open data-persist="yearly" className="group/yr border-b border-slate-100">
                <summary className="sticky top-[6.5rem] z-10 flex cursor-pointer list-none items-center justify-between rounded-lg bg-white px-2 py-2 hover:bg-slate-50 [&::-webkit-details-marker]:hidden sm:static">
                  <span className="flex items-center gap-1.5">
                    <svg width="14" height="14" viewBox="0 0 20 20" className="text-slate-400 transition-transform group-open/yr:rotate-90">
                      <path fill="currentColor" d="M7 5l6 5-6 5z" />
                    </svg>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-teal-600">
                      Yearly / periodic bills
                    </span>
                    <span className="text-[10px] text-slate-400">({yearlyRows.length})</span>
                  </span>
                  <span className="text-sm font-bold tabular-nums text-slate-700">
                    {formatINR(yearlySubtotal)}
                  </span>
                </summary>
                <div className="pl-3">
                  <div className="divide-y divide-slate-100 px-2 pb-1">
                    {yearlyRows.length === 0 ? (
                      <p className="py-2 text-xs text-slate-400">No annual / periodic bills due this month.</p>
                    ) : (
                      yearlyRows.map((e) => (
                        <ExpenseRow
                          key={e.id}
                          e={e}
                          canEditHere={canEditHere}
                          categories={c.categories}
                          members={c.members}
                          periodId={c.selected!.id}
                          periodMonth={c.selected!.month}
                        />
                      ))
                    )}
                  </div>
                  {canEditHere && (
                    <div className="px-2 py-2">
                      <ExpenseModal
                        categories={yearlyCats}
                        members={c.members}
                        periodId={c.selected!.id}
                        trigger="sheet"
                        balance={rollup.balance}
                        sheetLabel="+ Add yearly bill"
                        newCategoryDefaultSection="Yearly"
                      />
                    </div>
                  )}
                </div>
              </details>

              {/* Miscellaneous (unplanned / extra) — collapsible */}
              <details open data-persist="misc" className="group/msc">
                <summary className="sticky top-[6.5rem] z-10 flex cursor-pointer list-none items-center justify-between rounded-lg bg-white px-2 py-2 hover:bg-slate-50 [&::-webkit-details-marker]:hidden sm:static">
                  <span className="flex items-center gap-1.5">
                    <svg width="14" height="14" viewBox="0 0 20 20" className="text-slate-400 transition-transform group-open/msc:rotate-90">
                      <path fill="currentColor" d="M7 5l6 5-6 5z" />
                    </svg>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-600">
                      Miscellaneous · extra
                    </span>
                    <span className="text-[10px] text-slate-400">({miscRows.length})</span>
                  </span>
                  <span className="text-sm font-bold tabular-nums text-slate-700">
                    {formatINR(miscSubtotal)}
                  </span>
                </summary>
                <div className="pl-3">
                  <div className="divide-y divide-slate-100 px-2 pb-1">
                    {miscRows.length === 0 ? (
                      <p className="py-2 text-xs text-slate-400">No extra expenses this month.</p>
                    ) : (
                      miscRows.map((e) => (
                        <ExpenseRow
                          key={e.id}
                          e={e}
                          canEditHere={canEditHere}
                          categories={c.categories}
                          members={c.members}
                          periodId={c.selected!.id}
                          periodMonth={c.selected!.month}
                        />
                      ))
                    )}
                  </div>
                  {canEditHere && (
                    <div className="px-2 py-2">
                      <ExpenseModal
                        categories={miscCats}
                        members={c.members}
                        periodId={c.selected!.id}
                        trigger="sheet"
                        balance={rollup.balance}
                        sheetLabel="+ Add misc expense"
                        newCategoryDefaultSection="Misc"
                      />
                    </div>
                  )}
                </div>
              </details>
            </div>
          </details>
        </div>

        {/* skipped set-asides — freed this month; re-spread over the coming months.
            Collapsed by default; header carries the total freed this month. */}
        {skipped.length > 0 && (() => {
          const skippedTotal = skipped.reduce((s, x) => s + x.amount, 0);
          return (
            <details className="group/skip rounded-xl border border-amber-200 bg-amber-50 p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-1.5">
                  <svg width="14" height="14" viewBox="0 0 20 20" className="text-amber-500 transition-transform group-open/skip:rotate-90">
                    <path fill="currentColor" d="M7 5l6 5-6 5z" />
                  </svg>
                  <h2 className="text-sm font-semibold text-amber-800">⏭️ Skipped this month</h2>
                  <span className="text-[10px] text-amber-600">({skipped.length})</span>
                </span>
                <span className="text-sm font-bold tabular-nums text-amber-800">{formatINR(skippedTotal)} freed</span>
              </summary>
              <p className="mt-2 text-xs text-amber-700/80">
                These set-asides were skipped, so the money stayed available this month. Each one re-spreads over the coming months until its bill.
              </p>
              <ul className="mt-3 divide-y divide-amber-100">
                {skipped.map((s) => (
                  <li key={s.categoryId} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-amber-900">{s.name}</span>
                        {s.dueTag && (
                          <span className="shrink-0 rounded-full bg-amber-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-800">
                            bill due {s.dueTag === "this" ? "this month" : "next month"}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-amber-700/70">
                        would have set aside {formatINR(s.amount)} ·{" "}
                        {s.newShare != null
                          ? `remaining months now ~${formatINR(s.newShare)} each`
                          : "shortfall paid out-of-pocket on the due month"}
                      </div>
                    </div>
                    {canEditHere && (
                      <form action={restoreSetAside}>
                        <input type="hidden" name="categoryId" value={s.categoryId} />
                        <input type="hidden" name="periodId" value={c.selected!.id} />
                        <button className="shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100">
                          Add back to expenses
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          );
        })()}

        {/* balance + piggy */}
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-white p-5">
          <Stat label="Balance (Income − Expense)" value={formatINR(rollup.balance)} accent />
          <Stat label="🐷 Piggy bank" value={formatINR(c.piggyBalance)} />
        </div>

        {/* where did the income go — quick visual breakdown */}
        {rollup.totalIncome > 0 &&
          (() => {
            const segments = [
              ...grouped.map((g) => ({
                name: SECTION_LABEL[g.section],
                value: g.subtotal,
                color: SECTION_COLOR[g.section] ?? "#94a3b8",
              })),
              ...(rollup.balance > 0
                ? [{ name: "Left over", value: rollup.balance, color: "#22c55e" }]
                : []),
            ].filter((s) => s.value > 0);
            return (
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="mb-1 text-sm font-semibold text-slate-800">Where the income went</h2>
                <p className="mb-4 text-xs text-slate-500">
                  {formatINR(rollup.totalIncome)}{" "}came in this month. Here&apos;s where it went —
                  and what&apos;s left.
                </p>
                <MoneyFlowDonut
                  segments={segments}
                  centerLabel="Income"
                  centerValue={formatINR(rollup.totalIncome)}
                />
              </div>
            );
          })()}

        {!c.canEdit && (
          <p className="text-center text-xs text-slate-400">
            Read-only view. Only the head or a manager can edit income & expenses.
          </p>
        )}
      </main>
    </>
  );
}

function Row({
  label,
  sub,
  tag,
  amount,
  emoji,
  children,
}: {
  label: string;
  sub?: string;
  tag?: string | null;
  amount: number;
  emoji?: string | null;
  children?: React.ReactNode;
}) {
  // pull a trailing installment marker ("Chimney EMI 2/6") out into a tag
  const instMatch = label.match(/^(.*?)\s+(\d+\/\d+)$/);
  const baseLabel = instMatch ? instMatch[1] : label;
  const installment = instMatch ? instMatch[2] : null;
  return (
    <div className="flex items-center justify-between py-2.5 text-[15px]">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {emoji && <span className="shrink-0" aria-hidden>{emoji}</span>}
          <span className="truncate font-medium text-slate-800">{baseLabel}</span>
          {installment && (
            <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-500" title="installment (this payment / total)">
              {installment}
            </span>
          )}
        </div>
        {(sub || tag) && (
          <div className="text-xs text-slate-400">
            {sub}
            {sub && tag ? " · " : ""}
            {tag}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 pl-2">
        <span className="tabular-nums text-slate-700">{formatINR(amount)}</span>
        {children}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-bold ${accent ? "text-indigo-700" : "text-slate-800"}`}>
        {value}
      </div>
    </div>
  );
}

function SeedNotice() {
  return (
    <main className="mx-auto max-w-2xl p-10 text-center text-slate-600">
      No household yet. Run <code className="font-mono">npm run db:seed</code> to load the
      March data.
    </main>
  );
}
