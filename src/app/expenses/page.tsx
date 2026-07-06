import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getTrackedExpenses, getInHand, type InHand } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { AddSpendModal } from "@/components/AddSpendModal";
import { SpendDeleteButton } from "@/components/SpendDeleteButton";

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

  // "Budget left in hand" — per-person net (budget left − misc spent) + (head) account total.
  const inHand = await getInHand(c.household.id, c.selected.id);
  const currentMemberId = c.currentMember?.id ?? null;
  const headMember = c.members.find((m) => m.role === "head") ?? null;
  const headGroup = inHand.byPerson.find((g) => g.memberId === headMember?.id) ?? null;
  const accountTotal = inHand.piggyTotal + (headGroup?.net ?? 0) + inHand.shared.net;
  const myGroup = inHand.byPerson.find((g) => g.memberId === currentMemberId) ?? null;
  const visibleGroups = c.isHead ? inHand.byPerson : myGroup ? [myGroup] : [];
  const showShared = c.isHead && (inHand.shared.cats.length > 0 || inHand.shared.miscSpent > 0 || inHand.shared.bills.length > 0);
  const showInHand = visibleGroups.length > 0 || (c.isHead && (showShared || inHand.piggyTotal !== 0));

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

        {/* Budget left in hand — who still holds what (after misc, since it nets misc out) */}
        {showInHand && (
          <details open className="rounded-xl border border-slate-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between border-t-2 border-dashed border-slate-200 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="text-sm font-semibold text-slate-800">💰 Budget left in hand</span>
              <span className="text-xs text-slate-400">
                {c.isHead ? "who still holds what (budget left − misc spent)" : "your budget left − your misc spend"}
              </span>
            </summary>
            <div className="space-y-3 border-t border-slate-100 p-4">
              {c.isHead && (
                <div className="rounded-xl bg-slate-900 p-4 text-white dark:bg-slate-950">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-300">
                    Should be in {headMember?.name ?? "the"} account
                  </div>
                  <div className="mt-0.5 text-2xl font-extrabold tabular-nums">{formatINR(accountTotal)}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    Piggy {formatINR(inHand.piggyTotal)} + your net {formatINR(headGroup?.net ?? 0)}
                    {inHand.shared.net !== 0 ? ` + shared ${formatINR(inHand.shared.net)}` : ""}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {visibleGroups.map((g) => (
                  <PersonGroup key={g.memberId} group={g} />
                ))}
                {showShared && <PersonGroup group={inHand.shared} />}
              </div>
              {!c.isHead && !myGroup && (
                <p className="text-sm text-slate-400">You have no budgeted categories or misc spends this month.</p>
              )}
            </div>
          </details>
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

function PersonGroup({ group }: { group: InHand["byPerson"][number] | InHand["shared"] }) {
  const { name, cats, bills, miscSpent, net } = group;
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">{name}</span>
        <span className={`text-right text-sm font-bold tabular-nums ${net < 0 ? "text-red-600" : "text-emerald-700"}`}>
          {formatINR(net)}
          <span className="ml-1 text-[10px] font-normal text-slate-400">{net < 0 ? "to reclaim" : "in hand"}</span>
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
        {bills.map((b, i) => (
          <li key={`b${i}`} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-slate-500">
              {b.name} <span className="text-[10px] text-indigo-400">fixed bill</span>
            </span>
            <span className="shrink-0 tabular-nums text-slate-600">{formatINR(b.amount)}</span>
          </li>
        ))}
        {miscSpent > 0 && (
          <li className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-amber-600">Miscellaneous (unbudgeted)</span>
            <span className="shrink-0 tabular-nums text-red-600">− {formatINR(miscSpent)}</span>
          </li>
        )}
      </ul>
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
  return (
    <section className="flex flex-col rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="font-semibold text-slate-800">{card.name}</h2>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${owner ? "bg-indigo-50 text-indigo-500" : "bg-slate-100 text-slate-400"}`}
            title={owner ? `${owner} holds this budget — a spend here doesn't change their settlement` : "Shared budget — a spend here is credited to the spender at settlement"}
          >
            {owner ? `held by ${owner}` : "shared"}
          </span>
        </div>
        {open && (
          <AddSpendModal
            periodId={periodId}
            trigger="card"
            fixedCategory={{ id: card.id, name: card.name }}
            isHead={isHead}
            members={members}
            currentMemberId={currentMemberId}
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
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${card.overBudget ? "bg-red-500" : "bg-indigo-500"}`}
                style={{ width: `${pct}%` }}
              />
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
                <div className="text-[11px] text-slate-400">
                  {s.member?.name ?? "Shared"} ·{" "}
                  {new Date(s.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="tabular-nums text-slate-700">{formatINR(s.amount)}</span>
              {open && <SpendDeleteButton id={s.id} />}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
