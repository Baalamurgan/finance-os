import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getTrackedExpenses, getInHand, type InHand } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { AddSpendModal } from "@/components/AddSpendModal";
import { SpendDeleteButton } from "@/components/SpendDeleteButton";
import { SpendSubCategoryPicker } from "@/components/SpendSubCategoryPicker";
import { EditSpendModal } from "@/components/EditSpendModal";
import { MISC_SUBCATEGORIES } from "@/lib/misc";
import { toggleBillPaid } from "@/app/actions";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return null;

  const nav = (
    <NavHeader
      active="expenses"
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

  const { cards, totalAllocation, totalSpent, totalRemaining, miscSpent } =
    await getTrackedExpenses(c.household.id, c.selected.id);
  const budgetedCards = cards.filter((card) => card.allocation > 0);
  const miscCards = cards.filter((card) => card.allocation === 0);
  const open = c.selected.status === "open";

  // "Budget left in hand" — per-person real cash: budget left + tagged bills still to pay
  // − misc spent. The treasurer's row also carries the family pool (shared + month balance);
  // the piggy-holder's row also carries the Piggy bank.
  const inHand = await getInHand(c.household.id, c.selected.id);
  const currentMemberId = c.currentMember?.id ?? null;
  const visibleGroups = c.isHead
    ? inHand.byPerson
    : inHand.byPerson.filter((g) => g.memberId === currentMemberId);
  const canToggle = c.canEdit && open;
  const showInHand = visibleGroups.length > 0;

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
        </div>

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
                spent <b className="tabular-nums text-slate-700">{formatINR(miscSpent)}</b>{" "}
                <span className="text-xs text-slate-400">(not in allocation)</span>
              </span>
            </div>
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

        {/* Budget left in hand — who still holds what (budget left + bills to pay − misc) */}
        {showInHand ? (
          <details open className="rounded-xl border border-slate-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between border-t-2 border-dashed border-slate-200 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="text-sm font-semibold text-slate-800">💰 Budget left in hand</span>
              <span className="text-xs text-slate-400">
                {c.isHead ? "who still holds what (budget left + bills to pay − misc)" : "your budget left + bills to pay − misc"}
              </span>
            </summary>
            <div className="space-y-3 border-t border-slate-100 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {visibleGroups.map((g) => (
                  <PersonGroup
                    key={g.memberId}
                    group={g}
                    isTreasurer={g.memberId === inHand.treasurerId}
                    pool={inHand.treasurerPool}
                    sharedNet={inHand.shared.net}
                    monthBalance={inHand.monthBalance}
                    isPiggyHolder={g.memberId === inHand.piggyHolderId}
                    piggy={inHand.piggyTotal}
                    canToggle={canToggle}
                  />
                ))}
              </div>
            </div>
          </details>
        ) : (
          !c.isHead && (
            <p className="text-center text-xs text-slate-400">
              You have no budget, bills, or misc this month.
            </p>
          )
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

function PersonGroup({
  group,
  isTreasurer,
  pool,
  sharedNet,
  monthBalance,
  isPiggyHolder,
  piggy,
  canToggle,
}: {
  group: InHand["byPerson"][number];
  isTreasurer: boolean;
  pool: number;
  sharedNet: number;
  monthBalance: number;
  isPiggyHolder: boolean;
  piggy: number;
  canToggle: boolean;
}) {
  const { name, cats, unpaidBills, paidBills, miscSpent, net } = group;
  const poolAmt = isTreasurer ? pool : 0;
  const piggyAmt = isPiggyHolder ? piggy : 0;
  const total = net + poolAmt + piggyAmt;
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">
          {name}
          {isTreasurer && <span className="ml-1 text-[10px] font-normal text-indigo-500">treasurer</span>}
          {isPiggyHolder && <span className="ml-1 text-[10px] font-normal text-pink-500">piggy</span>}
        </span>
        <span className={`text-right text-sm font-bold tabular-nums ${total < 0 ? "text-red-600" : "text-emerald-700"}`}>
          {formatINR(total)}
          <span className="ml-1 text-[10px] font-normal text-slate-400">{total < 0 ? "to reclaim" : "in hand"}</span>
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {cats.map((cat) => (
          <li key={cat.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-slate-500">{cat.name}</span>
            <span className="shrink-0 tabular-nums text-slate-400">
              spent {formatINR(cat.spent)}/{formatINR(cat.allocation)} ·{" "}
              <b className={cat.remaining < 0 ? "text-red-600" : "text-slate-600"}>{formatINR(cat.remaining)}</b>
            </span>
          </li>
        ))}
        {unpaidBills.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-slate-500">
              {b.name} <span className="text-[10px] text-indigo-400">bill</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="tabular-nums text-slate-600">{formatINR(b.amount)}</span>
              {canToggle && (
                <form action={toggleBillPaid}>
                  <input type="hidden" name="id" value={b.id} />
                  <button
                    type="submit"
                    title="Mark this bill paid"
                    className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-emerald-300 hover:text-emerald-600"
                  >
                    ✓ paid
                  </button>
                </form>
              )}
            </span>
          </li>
        ))}
        {miscSpent > 0 && (
          <li className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-amber-600">Miscellaneous (unbudgeted)</span>
            <span className="shrink-0 tabular-nums text-red-600">− {formatINR(miscSpent)}</span>
          </li>
        )}
        {isTreasurer && (
          <li className="flex items-center justify-between gap-2 border-t border-dashed border-slate-100 pt-1 text-xs">
            <span className="truncate text-indigo-600">
              Family pool{" "}
              <span className="text-[10px] text-slate-400">
                shared {formatINR(sharedNet)} + month bal {formatINR(monthBalance)}
              </span>
            </span>
            <span className="shrink-0 tabular-nums font-medium text-indigo-700">{formatINR(pool)}</span>
          </li>
        )}
        {isPiggyHolder && piggy !== 0 && (
          <li className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-pink-600">🐷 Piggy bank held</span>
            <span className="shrink-0 tabular-nums font-medium text-pink-700">{formatINR(piggy)}</span>
          </li>
        )}
      </ul>
      {paidBills.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer list-none text-[11px] text-slate-400 [&::-webkit-details-marker]:hidden">
            ✓ Paid this month ({paidBills.length})
          </summary>
          <ul className="mt-1 space-y-1">
            {paidBills.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 text-xs text-slate-400">
                <span className="truncate line-through">{b.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="tabular-nums">{formatINR(b.amount)}</span>
                  {canToggle && (
                    <form action={toggleBillPaid}>
                      <input type="hidden" name="id" value={b.id} />
                      <button
                        type="submit"
                        title="Mark unpaid"
                        className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-slate-600"
                      >
                        undo
                      </button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {net < 0 && (
        <p className="mt-2 text-[11px] leading-tight text-amber-600">
          Fronted more than budget — reclaim from the treasurer at wind-down, or deduct from next month.
        </p>
      )}
    </div>
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
  return (
    <section className="flex flex-col rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="font-semibold text-slate-800">{card.name}</h2>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${owner ? "bg-indigo-50 text-indigo-500" : "bg-slate-100 text-slate-400"}`}
            title={owner ? `${owner} holds this budget — a spend here doesn't change their settlement` : "Shared budget — a spend here is credited to the spender at settlement"}
          >
            {owner ?? "shared"}
          </span>
        </div>
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
      </div>

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
    </section>
  );
}
