import { redirect } from "next/navigation";
import { loadCommon } from "@/lib/load";
import { NavHeader } from "@/components/NavHeader";
import { MonthlySetup } from "@/components/MonthlySetup";

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) redirect("/");
  if (!c.isHead) redirect("/");

  // tracked categories carry the recurring config
  const rows = c.categories
    .filter((cat) => cat.tracked)
    .map((cat) => ({
      id: cat.id,
      name: cat.name,
      monthlyBudget: cat.monthlyBudget,
      sinking: cat.sinking,
      cycleMonths: cat.cycleMonths,
      onHold: cat.onHold,
      responsibleMemberId: cat.responsibleMemberId ?? null,
    }));

  return (
    <>
      <NavHeader
        active="setup"
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

      <main className="mx-auto max-w-4xl space-y-5 p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Monthly setup</h1>
          <p className="text-sm text-slate-500">
            Set each category&apos;s recurring monthly budget. New months are pre-filled from
            these (plus a copy of last month&apos;s sheet). Mark **sinking funds** (e.g. WiFi every
            3 months, Mobile every 12) so their monthly share is held separately until the bill is
            due, instead of going to the general Piggy.
          </p>
        </div>

        <MonthlySetup rows={rows} householdId={c.household.id} members={c.members} />
      </main>
    </>
  );
}
