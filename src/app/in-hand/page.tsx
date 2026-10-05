import { formatINR } from "@/lib/format";
import { istDateParts } from "@/lib/time";
import { loadCommon } from "@/lib/load";
import { getInHand, getMoneyPlan, getMoneyPlanActivity, getFamilyCreditCards, type InHand } from "@/lib/queries";
import { pendingCashMoveByMember, doneCashMoveByMember, doneCashMoveDetailByMember } from "@/lib/moneyPlan";
import { MoneyPlanActivity } from "@/components/MoneyPlanActivity";
import { NavHeader } from "@/components/NavHeader";
import { MoneyPlan } from "@/components/MoneyPlan";
import { InHandPersonGroup } from "@/components/InHandPersonGroup";

export default async function InHandPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return null;

  const nav = (
    <NavHeader
      active="in-hand"
      householdName={c.household.name}
      miscSubCategories={c.miscSubCategories}
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

  const open = c.selected.status === "open";
  // A preview (draft) month is a PROJECTION of a future month — its In-Hand isn't your real current cash
  // (that's the open month's), and it only firms up once the current month winds down. Flag it so the
  // numbers read as an estimate, and lead with "Expected by month-end" rather than a fake "holding now".
  const isPreview = c.selected.status === "draft";
  const periodId = c.selected.id;
  // Real cash each person holds: budget left + bills to pay + savings held − misc spent.
  const inHand = await getInHand(c.household.id, periodId);
  const [plan, activity, cardsByMember] = await Promise.all([
    getMoneyPlan(c.household.id, periodId, inHand),
    getMoneyPlanActivity(periodId),
    // The payer's own credit cards power the "Paid with" picker on each bill's Pay modal.
    getFamilyCreditCards(c.household.id),
  ]);
  const currentMemberId = c.currentMember?.id ?? null;
  // Today's day-of-month (IST) — but only when viewing the CURRENT month, so the Money Plan leaves just
  // today's date expanded and folds the rest. Any other month in view → null → every day folds.
  const ist = istDateParts();
  const currentDay = c.selected.year === ist.year && c.selected.month === ist.month ? ist.day : null;
  // "Holding now" per member = their projected In-Hand total MINUS the cash-moves not yet completed
  // (see pendingCashMoveByMember). Backs each member's total down to what they physically hold given
  // only the steps done so far; converges to the projection as the plan is worked through.
  const pendingByMember = pendingCashMoveByMember(plan.steps);
  // Real "holding now" ledger: completed cash-moves so far (income received, transfers done, bills/card
  // bills paid). The component adds each member's standing balances (Piggy/sinking/pending hand-overs)
  // and subtracts their cash spent, so holding-now = actual bank cash, not a projection.
  const doneByMember = doneCashMoveByMember(plan.steps);
  // Per-member list of this month's completed moves — drives the "how this adds up" breakdown on the card.
  const doneDetailByMember = doneCashMoveDetailByMember(plan.steps);
  // Reconciling "Where it's allocated" inputs: a member's salary-funded lines (budgets / set-asides /
  // held bills / to-treasurer / last-month misc) appear only once their income has ARRIVED — before
  // that their card shows just the carry. `toTreasurerPending` is their still-unpaid settlement
  // hand-over to the treasurer (a line that drops off once they pay it, so the breakdown reconciles
  // in both states).
  const incomeReceivedByMember: Record<number, boolean> = {};
  const toTreasurerPendingByMember: Record<number, number> = {};
  for (const s of plan.steps) {
    if (s.kind === "income" && s.done && s.toId != null) incomeReceivedByMember[s.toId] = true;
    if (!s.done && s.fromId != null && s.toId === inHand.treasurerId && (s.kind === "transfer-in" || s.kind === "transfer-out" || s.kind === "pool-handover")) {
      toTreasurerPendingByMember[s.fromId] = Math.round(((toTreasurerPendingByMember[s.fromId] ?? 0) + s.amount) * 100) / 100;
    }
  }
  const visibleGroups = c.isHead
    ? inHand.byPerson
    : inHand.byPerson.filter((g) => g.memberId === currentMemberId);
  // Settlement lock: once the month is settled, non-heads can't change bill/paid state.
  const canToggle = c.canEdit && open && !(c.locked && !c.isHead);
  const showInHand = visibleGroups.length > 0;

  return (
    <>
      {nav}
      {/* Tighter top/side padding on mobile shrinks the header↔content gap; the global `main` x-clip
          (globals.css) keeps any stray wide row from pushing the page past the viewport. */}
      <main className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">🧭 Money plan</h1>
          <p className="text-sm text-slate-500">
            {c.isHead
              ? "The order to move money this month, then who still holds what."
              : "Your steps this month, then your budget left + bills + savings − misc."}
          </p>
        </div>

        <MoneyPlan
          plan={plan}
          householdId={c.household.id}
          periodId={periodId}
          isHead={c.isHead}
          currentMemberId={currentMemberId}
          canEdit={c.canEdit}
          open={open}
          datesEditable={open || c.selected.status === "draft"}
          generalPiggy={inHand.generalPiggy}
          billCategories={c.categories
            .filter((cat) => !cat.tracked && cat.fundingStyle == null && !cat.isAllowance)
            .map((cat) => ({ id: cat.id, name: cat.name, section: cat.section }))}
          members={c.members.map((m) => ({ id: m.id, name: m.name }))}
          monthBalance={inHand.monthBalance}
          cardsByMember={cardsByMember}
          currentDay={currentDay}
        />

        {showInHand && isPreview && (
          <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-700">
            🔮 <b>Preview month</b> — these are <b>projected</b>, not your current cash (that&apos;s this month&apos;s). They firm up once the current month winds down. The number to plan by here is <b>Expected by month-end</b>.
          </div>
        )}
        {showInHand ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visibleGroups.map((g) => (
              <InHandPersonGroup
                key={g.memberId}
                group={g}
                cards={g.memberId != null ? cardsByMember[g.memberId] ?? [] : []}
                isPreview={isPreview}
                pendingCashMove={g.memberId != null ? pendingByMember[g.memberId] ?? 0 : 0}
                doneCashMove={g.memberId != null ? doneByMember[g.memberId] ?? 0 : 0}
                doneMoves={g.memberId != null ? doneDetailByMember[g.memberId] ?? [] : []}
                incomeReceived={g.memberId != null ? incomeReceivedByMember[g.memberId] ?? false : false}
                toTreasurerPending={g.memberId != null ? toTreasurerPendingByMember[g.memberId] ?? 0 : 0}
                isTreasurer={g.memberId === inHand.treasurerId}
                pool={inHand.treasurerPool}
                sharedNet={inHand.shared.net}
                monthBalance={inHand.monthBalance}
                billsHeldForMembers={inHand.poolHoldsForMembers}
                isPiggyHolder={g.memberId === inHand.piggyHolderId}
                piggy={inHand.generalPiggy}
                pendingPiggyLump={inHand.pendingPiggyHandover?.lump ?? 0}
                canToggle={canToggle}
                periodId={periodId}
                generalPiggy={inHand.generalPiggy}
                currentMemberId={currentMemberId}
                open={open}
                selYear={c.selYear}
                selMonth={c.selMonth}
                poolIncoming={g.memberId === inHand.treasurerId ? inHand.poolIncoming : []}
                poolDisbursements={
                  g.memberId === inHand.treasurerId
                    ? inHand.allowances
                        .filter((a) => !a.done && a.recipientId !== inHand.treasurerId)
                        .map((a) => ({ recipientId: a.recipientId, recipientName: a.recipientName, label: a.label, amount: a.amount }))
                    : []
                }
                treasurerOwnLeftover={g.memberId === inHand.treasurerId ? inHand.treasurerOwnLeftover : 0}
              />
            ))}
          </div>
        ) : (
          <p className="text-center text-sm text-slate-400">
            Nothing in hand this month — no budget, bills, savings or misc.
          </p>
        )}

        <MoneyPlanActivity items={activity} />

        {!open && (
          <p className="text-center text-xs text-slate-400">This month is closed — figures are locked.</p>
        )}
      </main>
    </>
  );
}

