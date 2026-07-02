import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getRollup } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { RowActions } from "@/components/RowActions";
import { ExpenseRowActions } from "@/components/ExpenseRowActions";
import { ExpenseModal } from "@/components/ExpenseModal";
import { IncomeModal } from "@/components/IncomeModal";
import { createPeriod, deleteIncome } from "./actions";

const SECTION_ORDER = ["Loans", "Chits", "Monthly", "Misc"] as const;
const SECTION_LABEL: Record<string, string> = {
  Loans: "Loans",
  Chits: "Chits",
  Monthly: "Monthly Expense",
  Misc: "Miscellaneous",
};

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
}: {
  e: ExpRow;
  canEditHere: boolean;
  categories: CatLite[];
  members: MemLite[];
  periodId: number;
}) {
  return (
    <Row label={e.label} sub={e.category.name} tag={e.member?.name} amount={e.amount}>
      {canEditHere && (
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
}: {
  g: { section: string; rows: ExpRow[]; subtotal: number };
  canEditHere: boolean;
  categories: CatLite[];
  members: MemLite[];
  periodId: number;
}) {
  return (
    <details className="group border-b border-slate-100 last:border-0">
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

  const nav = (
    <NavHeader
      active="sheet"
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
  const open = c.selected.status === "open";

  // Safeguard: if the current calendar month has no period yet (e.g. the monthly
  // auto-create didn't run), nudge the head to start it so the family always has
  // an open month to log into.
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const currentMonthMissing = !c.periods.some((p) => p.year === curY && p.month === curM);

  // Head + Manager edit open months; the head can also edit a closed (locked) month.
  const canEditHere = c.canEdit && (open || c.isHead);
  const editingClosed = canEditHere && !open; // head editing a locked month

  // group expenses into the fixed section order
  const grouped = SECTION_ORDER.map((section) => {
    const rows = rollup.expenses.filter((e) => e.category.section === section);
    return { section, rows, subtotal: rows.reduce((s, e) => s + e.amount, 0) };
  }).filter((g) => g.rows.length > 0);

  // split the Expense column into two blocks: fixed monthly (Loans+Chits+Monthly)
  // vs miscellaneous/extra (Misc). Each has its own subtotal + Add expense.
  const FIXED_SECTIONS = ["Loans", "Chits", "Monthly"];
  const fixedGroups = grouped.filter((g) => FIXED_SECTIONS.includes(g.section));
  const miscRows = rollup.expenses.filter((e) => e.category.section === "Misc");
  const fixedSubtotal = fixedGroups.reduce((s, g) => s + g.subtotal, 0);
  const miscSubtotal = miscRows.reduce((s, e) => s + e.amount, 0);
  const fixedCats = c.categories.filter((cat) => FIXED_SECTIONS.includes(cat.section));
  const miscCats = c.categories.filter((cat) => cat.section === "Misc");

  return (
    <>
      {nav}
      <main className="mx-auto max-w-[68rem] space-y-4 p-6">
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
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                open ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"
              }`}
            >
              {open ? "Open" : "Closed"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          {/* INCOME — collapsible column; total shown in the green summary bar */}
          <details className="group/inc min-w-0 overflow-hidden rounded-xl border border-green-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between border-l-4 border-green-500 bg-green-50 px-4 py-3 [&::-webkit-details-marker]:hidden">
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
                  {canEditHere && <RowActions id={i.id} deleteAction={deleteIncome} />}
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
          <details className="group/exp min-w-0 overflow-hidden rounded-xl border border-red-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between border-l-4 border-red-500 bg-red-50 px-4 py-3 [&::-webkit-details-marker]:hidden">
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
              <details open className="group/fx border-b border-slate-100">
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2 py-2 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
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

              {/* Miscellaneous (unplanned / extra) — collapsible */}
              <details open className="group/msc">
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2 py-2 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
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

        {/* balance + piggy */}
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-white p-5">
          <Stat label="Balance (Income − Expense)" value={formatINR(rollup.balance)} accent />
          <Stat label="🐷 Piggy bank" value={formatINR(c.piggyBalance)} />
        </div>

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
  children,
}: {
  label: string;
  sub?: string;
  tag?: string | null;
  amount: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 text-[15px]">
      <div className="min-w-0">
        <div className="truncate font-medium text-slate-800">{label}</div>
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
