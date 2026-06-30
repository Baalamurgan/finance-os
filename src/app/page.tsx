import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getRollup } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { RowActions } from "@/components/RowActions";
import { ExpenseRowActions } from "@/components/ExpenseRowActions";
import { addIncome, createPeriod, deleteIncome } from "./actions";

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
          {/* INCOME */}
          <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
            <ColHeader title="INCOME" tone="green" />
            <div className="flex-1 divide-y divide-slate-100 px-4 py-1">
              {rollup.incomes.map((i) => (
                <Row key={i.id} label={i.source} tag={i.owner?.name} amount={i.amount}>
                  {canEditHere && <RowActions id={i.id} deleteAction={deleteIncome} />}
                </Row>
              ))}
              {canEditHere && (
                <details className="py-2 text-sm">
                  <summary className="cursor-pointer text-indigo-600">+ Add income</summary>
                  <form action={addIncome} className="mt-2 space-y-2">
                    <input type="hidden" name="periodId" value={c.selected.id} />
                    <input name="source" placeholder="Source" required className="input w-full" />
                    <input name="amount" type="number" step="0.01" placeholder="Amount" required className="input w-full" />
                    <select name="ownerId" className="input w-full">
                      <option value="">Shared</option>
                      {c.members.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                    <button className="btn w-full">Add</button>
                  </form>
                </details>
              )}
            </div>
            <ColTotal label="Total Income" value={rollup.totalIncome} tone="green" />
          </section>

          {/* EXPENSE — collapsible sections, single column */}
          <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
            <ColHeader title="EXPENSE" tone="red" />
            <div className="flex-1 px-2 py-1">
              {grouped.map((g) => (
                <details key={g.section} className="group border-b border-slate-100 last:border-0">
                  <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2 py-2 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-1.5">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 20 20"
                        className="text-slate-400 transition-transform group-open:rotate-90"
                      >
                        <path fill="currentColor" d="M7 5l6 5-6 5z" />
                      </svg>
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {SECTION_LABEL[g.section]}
                      </span>
                      <span className="text-[10px] text-slate-400">({g.rows.length})</span>
                    </span>
                    <span className="text-sm font-bold tabular-nums text-slate-700">
                      {formatINR(g.subtotal)}
                    </span>
                  </summary>
                  <div className="divide-y divide-slate-100 px-2 pb-1">
                    {g.rows.map((e) => (
                      <Row
                        key={e.id}
                        label={e.label}
                        sub={e.category.name}
                        tag={e.member?.name}
                        amount={e.amount}
                      >
                        {canEditHere && (
                          <ExpenseRowActions
                            categories={c.categories}
                            members={c.members}
                            periodId={c.selected!.id}
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
                    ))}
                  </div>
                </details>
              ))}
            </div>
            <ColTotal label="Total Expense" value={rollup.totalExpense} tone="red" />
          </section>
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

function ColHeader({
  title,
  tone,
}: {
  title: string;
  tone: "green" | "red";
}) {
  const tones = { green: "text-green-700", red: "text-red-700" } as const;
  return (
    <div className="border-b border-slate-200 px-5 py-3">
      <h2 className={`text-base font-bold tracking-wide ${tones[tone]}`}>{title}</h2>
    </div>
  );
}

function ColTotal({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "red";
}) {
  const tones = {
    green: "border-green-500 bg-green-50 text-green-700",
    red: "border-red-500 bg-red-50 text-red-700",
  } as const;
  return (
    <div className={`flex items-center justify-between border-t-2 px-4 py-3.5 ${tones[tone]}`}>
      <span className="text-[11px] font-bold uppercase tracking-widest">{label}</span>
      <span className="text-2xl font-extrabold tabular-nums">{formatINR(value)}</span>
    </div>
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
