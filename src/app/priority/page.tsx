import { loadCommon } from "@/lib/load";
import { NavHeader } from "@/components/NavHeader";
import { PriorityBoard } from "@/components/PriorityBoard";
import { getPriorityPayables } from "@/lib/priority/data";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function PriorityPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return null;

  const period = c.selected ? { id: c.selected.id, month: c.selected.month } : null;
  const payables = await getPriorityPayables(c.household.id, period);
  const periodId = c.selected?.id ?? null;
  const monthLabel = `${MONTHS[(c.selMonth - 1 + 12) % 12]} ${c.selYear}`;

  return (
    <>
      <NavHeader
        active="priority"
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
        periodId={periodId}
        periodOpen={c.selected?.status === "open"}
        currentMemberId={c.currentMember?.id}
        windDownReminder={c.windDownReminder}
        canEdit={c.canEdit}
        pinEnabled={c.pinEnabled}
        hasBiometric={c.hasBiometric}
        actualIsHead={c.actualIsHead}
        viewingAsMember={c.viewingAsMember}
      />

      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <PriorityBoard payables={payables} monthLabel={monthLabel} />
      </main>
    </>
  );
}
