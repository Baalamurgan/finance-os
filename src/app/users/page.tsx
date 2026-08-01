import { redirect } from "next/navigation";
import { loadCommon } from "@/lib/load";
import { NavHeader } from "@/components/NavHeader";
import { ManageUsers } from "@/components/ManageUsers";
import { PinSettings } from "@/components/PinSettings";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) redirect("/");
  if (!c.isHead) redirect("/");

  return (
    <>
      <NavHeader
        active="users"
        householdName={c.household.name}
        selYear={c.selYear}
        selMonth={c.selMonth}
        previewPeriod={c.previewPeriod}
        provisional={c.provisional}
        members={c.members}        categories={c.categories}
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

      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Settings</h1>
          <p className="text-sm text-slate-500">Manage who can sign in, and the app lock.</p>
        </div>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">Members</h2>
          <p className="text-xs text-slate-500">Add a member&apos;s Google email to let them sign in.</p>
          <ManageUsers
            members={c.members.map((m) => ({
              id: m.id,
              name: m.name,
              code: m.code,
              email: m.email,
              role: m.role,
            }))}
            householdId={c.household.id}
            currentMemberId={c.currentMember.id}
          />
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">App lock</h2>
          <PinSettings isSet={c.pinEnabled} readOnly={false} />
        </section>
      </main>
    </>
  );
}
