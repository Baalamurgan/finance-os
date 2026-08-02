import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getTrackedExpenses, getMiscReview } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { AddSpendModal } from "@/components/AddSpendModal";
import { MiscReview } from "@/components/MiscReview";
import { SpendDeleteButton } from "@/components/SpendDeleteButton";
import { SpendSubCategoryPicker } from "@/components/SpendSubCategoryPicker";
import { EditSpendModal } from "@/components/EditSpendModal";
import { ExpensesSortControl } from "@/components/ExpensesSortControl";
import { MISC_SUBCATEGORIES } from "@/lib/misc";

type SortKey = "date" | "amount" | "member";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string; sort?: string; member?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return null;

  const sort: SortKey = sp.sort === "amount" || sp.sort === "member" ? sp.sort : "date";
  const filterMemberId = sp.member ? Number(sp.member) : null;
  const filterMemberName = filterMemberId != null ? c.members.find((m) => m.id === filterMemberId)?.name ?? null : null;

  const nav = (
    <NavHeader
      active="expenses"
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

  if (c.noData || !c.selected) {
    return (
      <>
        {nav}
        <main className="mx-auto max-w-2xl p-16 text-center text-slate-500">
          No month selected. Start a month on the Sheet tab first.
        </main>
      </>
    );
  }

  const { cards: rawCards, totalAllocation, totalSpent, totalRemaining, miscSpent } =
    await getTrackedExpenses(c.household.id, c.selected.id);

  // Apply the chosen sort (and optional per-member filter, e.g. arriving from Settlement)
  // to each card's spend list. Totals above stay on the full month — filtering is view-only.
  const memberName = (id: number | null) => (id != null ? c.members.find((m) => m.id === id)?.name ?? "" : "Shared");
  const orderSpends = <T extends { amount: number; createdAt: Date; memberId: number | null }>(rows: T[]): T[] => {
    const filtered = filterMemberId != null ? rows.filter((s) => s.memberId === filterMemberId) : rows;
    const by = [...filtered];
    if (sort === "amount") by.sort((a, b) => b.amount - a.amount);
    else if (sort === "member") by.sort((a, b) => memberName(a.memberId).localeCompare(memberName(b.memberId)) || b.createdAt.getTime() - a.createdAt.getTime());
    else by.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // date (newest first)
    return by;
  };
  const cards = rawCards.map((card) => ({ ...card, spends: orderSpends(card.spends) }));
  const budgetedCards = cards.filter((card) => card.allocation > 0);
  const miscCards = cards.filter((card) => card.allocation === 0);
  // When filtered to a member, the summary reflects only THAT member's spends ("everything they
  // spent") — allocation/remaining don't apply to one person, so we show budgeted-spend + misc.
  const sumSpends = (cs: typeof cards) => cs.reduce((s, c) => s + c.spends.reduce((a, x) => a + x.amount, 0), 0);
  const filteredBudgetedSpent = filterMemberId != null ? sumSpends(budgetedCards) : null;
  const filteredMisc = filterMemberId != null ? sumSpends(miscCards) : null;
  const open = c.selected.status === "open";
  // Head-only tidy-up: misc spends that look like a tracked category (open month only).
  const miscReview = c.isHead && open ? await getMiscReview(c.household.id, c.selected.id) : [];

  return (
    <>
      {nav}
      <main className="mx-auto max-w-7xl space-y-5 p-6 pb-28 sm:pb-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {c.selected.label} — daily spends
            </h1>
            <p className="text-sm text-slate-500">
              Daily variable spending against each category&apos;s budget — the unspent remainder
              moves to Piggy at wind-down. For loans / bills / one-offs that change the balance, use
              <b> + Add expense</b> on the Sheet instead.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ExpensesSortControl sort={sort} />
            {filterMemberId != null ? (
              <div className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-right">
                <div className="text-[11px] font-medium uppercase tracking-wide text-indigo-400">
                  {filterMemberName}&apos;s spend
                </div>
                <div className="text-lg font-bold text-slate-800">
                  {formatINR(filteredBudgetedSpent ?? 0)}{" "}
                  <span className="text-sm font-normal text-slate-400">budgeted</span>
                </div>
                <div className="text-xs text-amber-600">+ {formatINR(filteredMisc ?? 0)} misc</div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-right">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Spent / Allocated
                </div>
                <div className="text-lg font-bold text-slate-800">
                  {formatINR(totalSpent)}{" "}
                  <span className="text-sm font-normal text-slate-400">
                    / {formatINR(totalAllocation)}
                  </span>
                </div>
                <div className={`text-xs ${totalRemaining >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {totalRemaining >= 0 ? "Remaining " : "Over by "}
                  {formatINR(Math.abs(totalRemaining))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* active per-member filter (e.g. arrived from Settlement → a member's Misc) */}
        {filterMemberName && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm">
            <span className="text-indigo-800">
              Showing only <b>{filterMemberName}</b>&apos;s spends
            </span>
            <a
              href={`/expenses?y=${c.selYear}&m=${c.selMonth}&sort=${sort}`}
              className="rounded-md border border-indigo-300 bg-white px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
            >
              ✕ Clear filter
            </a>
          </div>
        )}

        {/* budgeted categories (count toward Spent / Allocated above) */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {budgetedCards.map((card) => (
            <SpendCard
              key={card.id}
              card={card}
              open={open}
              periodId={c.selected!.id}
              isHead={c.isHead}
              members={c.members}
              currentMemberId={c.currentMember?.id}
            />
          ))}
        </div>

        {/* miscellaneous / unplanned — shown separately, NOT counted in the totals above */}
        {miscCards.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between border-t-2 border-dashed border-slate-200 pt-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-amber-600">
                Miscellaneous · unplanned
              </h2>
              <span className="text-sm text-slate-500">
                spent <b className="tabular-nums text-slate-700">{formatINR(filteredMisc ?? miscSpent)}</b>{" "}
                <span className="text-xs text-slate-400">
                  {filterMemberName ? `(${filterMemberName}, not in allocation)` : "(not in allocation)"}
                </span>
              </span>
            </div>
            <MiscReview items={miscReview} />
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {miscCards.map((card) => (
                <SpendCard
                  key={card.id}
                  card={card}
                  open={open}
                  periodId={c.selected!.id}
                  isHead={c.isHead}
                  members={c.members}
                  currentMemberId={c.currentMember?.id}
                />
              ))}
            </div>
          </section>
        )}

        {!open && (
          <p className="text-center text-xs text-slate-400">
            This month is closed — spends are locked.
          </p>
        )}
      </main>
    </>
  );
}
type SpendCardData = Awaited<ReturnType<typeof getTrackedExpenses>>["cards"][number];

function SpendCard({
  card,
  open,
  periodId,
  isHead,
  members,
  currentMemberId,
}: {
  card: SpendCardData;
  open: boolean;
  periodId: number;
  isHead: boolean;
  members: { id: number; name: string }[];
  currentMemberId?: number | null;
}) {
  const pct = card.allocation > 0 ? Math.min((card.spent / card.allocation) * 100, 100) : 0;
  const owner = card.responsibleMemberId != null ? members.find((m) => m.id === card.responsibleMemberId)?.name ?? null : null;
  const isMisc = card.section === "Misc"; // the Personal/Misc bucket — spends carry a sub-category
  const cid = `card-${card.id}`;
  return (
    <section className="flex flex-col rounded-xl border border-slate-200 bg-white">
      {/* mobile-only collapse toggle (pure CSS): body is hidden on mobile until checked,
          always visible from sm: up. No JS → no hydration flash. */}
      <input type="checkbox" id={cid} className="peer sr-only" />
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <label htmlFor={cid} className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 sm:cursor-default">
          <h2 className="truncate font-semibold text-slate-800">{card.name}</h2>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${owner ? "bg-indigo-50 text-indigo-500" : "bg-slate-100 text-slate-400"}`}
            title={owner ? `${owner} holds this budget — a spend here doesn't change their settlement` : "Shared budget — a spend here is credited to the spender at settlement"}
          >
            {owner ?? "shared"}
          </span>
        </label>
        <div className="flex items-center gap-2">
          {/* compact figure so a collapsed card still shows the spend at a glance (mobile) */}
          <span className="shrink-0 text-xs tabular-nums text-slate-500 sm:hidden">
            {formatINR(card.spent)}
            {card.allocation > 0 && <span className="text-slate-400"> / {formatINR(card.allocation)}</span>}
          </span>
          {open && (
            <AddSpendModal
              periodId={periodId}
              trigger="card"
              fixedCategory={{ id: card.id, name: card.name, misc: isMisc }}
              isHead={isHead}
              members={members}
              currentMemberId={currentMemberId}
              subCategories={isMisc ? MISC_SUBCATEGORIES : undefined}
            />
          )}
          <label htmlFor={cid} className="cursor-pointer rounded-md p-1 text-slate-400 hover:bg-slate-100 sm:hidden" aria-label={`Expand ${card.name}`}>
            <svg width="16" height="16" viewBox="0 0 20 20" className="transition-transform peer-checked:rotate-90">
              <path fill="currentColor" d="M7 5l6 5-6 5z" />
            </svg>
          </label>
        </div>
      </div>

      <div className="hidden peer-checked:block sm:block">
      <div className="px-4 pt-3">
        {card.sinking && card.allocation > 0 ? (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">
                Spent <b className="text-slate-800">{formatINR(card.spent)}</b>
              </span>
              <span className="text-xs font-medium text-indigo-600">
                {card.spent > card.allocation
                  ? `₹${Math.round(card.spent - card.allocation).toLocaleString("en-IN")} from fund`
                  : `${formatINR(card.remaining)} → fund`}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              Monthly share {formatINR(card.allocation)} · Fund{" "}
              <b className={card.fund < 0 ? "text-red-600" : "text-slate-600"}>{formatINR(card.fund)}</b>{" "}
              held — a bill over the share draws from the fund at month close.
            </div>
          </>
        ) : card.allocation > 0 ? (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">
                Spent <b className="text-slate-800">{formatINR(card.spent)}</b>
                <span className="text-slate-400"> / {formatINR(card.allocation)}</span>
              </span>
              <span className={`text-xs font-medium ${card.overBudget ? "text-red-600" : "text-green-600"}`}>
                {card.overBudget
                  ? `over by ${formatINR(card.spent - card.allocation)}`
                  : `${formatINR(card.remaining)} left → Piggy`}
              </span>
            </div>
            <div className="relative mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              {/* green (plenty left) → yellow → red (near/over budget); the grey mask on
                  the right hides the part not yet spent, so the fill edge shows the tone. */}
              <div
                className="absolute inset-0"
                style={{ background: "linear-gradient(to right, #22c55e 0%, #eab308 60%, #ef4444 100%)" }}
              />
              <div className="absolute inset-y-0 right-0 bg-slate-100" style={{ width: `${100 - pct}%` }} />
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">
              Spent <b className="text-slate-800">{formatINR(card.spent)}</b>
            </span>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              One-off · not budgeted
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 divide-y divide-slate-100 overflow-y-auto px-4 py-2 sm:max-h-64">
        {card.spends.length === 0 && <p className="py-3 text-sm text-slate-400">No spends logged yet.</p>}
        {card.spends.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              {s.imagePath && (
                <a href={s.imagePath} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.imagePath} alt="receipt" className="h-9 w-9 rounded object-cover" />
                </a>
              )}
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-800">{s.label}</div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                  <span>
                    {s.member?.name ?? "Shared"} ·{" "}
                    {new Date(s.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </span>
                  {isMisc && (
                    <SpendSubCategoryPicker
                      id={s.id}
                      value={s.subCategory}
                      options={MISC_SUBCATEGORIES}
                      canEdit={open && (isHead || s.memberId === currentMemberId)}
                    />
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="tabular-nums text-slate-700">{formatINR(s.amount)}</span>
              {open && (isHead || s.memberId === currentMemberId) && (
                <EditSpendModal
                  spend={{ id: s.id, label: s.label, amount: s.amount, memberId: s.memberId, subCategory: s.subCategory }}
                  categoryName={card.name}
                  isMisc={isMisc}
                  subCategories={isMisc ? MISC_SUBCATEGORIES : undefined}
                  isHead={isHead}
                  members={members}
                />
              )}
              {open && <SpendDeleteButton id={s.id} />}
            </div>
          </div>
        ))}
      </div>
      </div>
    </section>
  );
}
