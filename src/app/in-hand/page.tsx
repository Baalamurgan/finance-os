import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getInHand, getMoneyPlan, getMoneyPlanActivity, type InHand } from "@/lib/queries";
import { pendingCashMoveByMember } from "@/lib/moneyPlan";
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
  const periodId = c.selected.id;
  // Real cash each person holds: budget left + bills to pay + savings held − misc spent.
  const inHand = await getInHand(c.household.id, periodId);
  const [plan, activity] = await Promise.all([
    getMoneyPlan(c.household.id, periodId, inHand),
    getMoneyPlanActivity(periodId),
  ]);
  const currentMemberId = c.currentMember?.id ?? null;
  // "Holding now" per member = their projected In-Hand total MINUS the cash-moves not yet completed
  // (see pendingCashMoveByMember). Backs each member's total down to what they physically hold given
  // only the steps done so far; converges to the projection as the plan is worked through.
  const pendingByMember = pendingCashMoveByMember(plan.steps);
  const visibleGroups = c.isHead
    ? inHand.byPerson
    : inHand.byPerson.filter((g) => g.memberId === currentMemberId);
  // Settlement lock: once the month is settled, non-heads can't change bill/paid state.
  const canToggle = c.canEdit && open && !(c.locked && !c.isHead);
  const showInHand = visibleGroups.length > 0;

  return (
    <>
      {nav}
      <main className="mx-auto max-w-2xl space-y-4 p-6">
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
        />

        {showInHand ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visibleGroups.map((g) => (
              <InHandPersonGroup
                key={g.memberId}
                group={g}
                pendingCashMove={g.memberId != null ? pendingByMember[g.memberId] ?? 0 : 0}
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

