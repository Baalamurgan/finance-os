import { redirect } from "next/navigation";
import { loadCommon } from "@/lib/load";
import { getFamilyCards } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { FamilyCardsManager } from "@/components/FamilyCardsManager";

export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) redirect("/");

  // All cards (incl. hidden) for management; the Add-Spend picker uses active-only via getSpendAssist.
  const cards = await getFamilyCards(c.household.id, false);

  return (
    <>
      <NavHeader
        active="cards"
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

      <main className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">💳 Cards</h1>
          <p className="text-sm text-slate-500">Debit &amp; credit cards the family pays with.</p>
        </div>

        <FamilyCardsManager
          cards={cards}
          members={c.members.map((m) => ({ id: m.id, name: m.name }))}
          currentMemberId={c.currentMember?.id ?? null}
          isHead={c.isHead}
        />
      </main>
    </>
  );
}
