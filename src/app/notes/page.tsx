import { loadCommon } from "@/lib/load";
import { NavHeader } from "@/components/NavHeader";
import { FamilyNote } from "@/components/FamilyNote";

// Shared family note — a common scratch pad every member can read & edit, behind the app lock.
export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return null;

  const lastEditedBy = c.household.notesUpdatedById
    ? c.members.find((m) => m.id === c.household.notesUpdatedById)?.name ?? null
    : null;

  return (
    <>
      <NavHeader
        active="notes"
        householdName={c.household.name}
        selYear={c.selYear}
        selMonth={c.selMonth}
        previewPeriod={c.previewPeriod}
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
      <main className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">📝 Family notes</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            One shared note for the whole family — anyone can add or edit. A place for details
            everyone should be able to find.
          </p>
        </div>
        <FamilyNote
          initial={c.household.notes ?? ""}
          lastEditedBy={lastEditedBy}
          lastEditedAtISO={c.household.notesUpdatedAt ? c.household.notesUpdatedAt.toISOString() : null}
        />
      </main>
    </>
  );
}
