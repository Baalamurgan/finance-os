import { loadPersonal } from "@/lib/loadPersonal";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { TodayView } from "@/components/personal/today/TodayView";
import { getTodayData } from "@/lib/os/today";

// The Personal OS command center — "what matters right now". Deterministic (no AI):
// Google Calendar + finance/bill alerts + birthdays, in a timeline or grouped view.
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);

  const data = await getTodayData({
    memberId: c.member.id,
    householdId: c.member.householdId,
    personalPeriod: c.selected ? { id: c.selected.id, income: c.selected.income, carryForward: c.selected.carryForward } : null,
  });

  return (
    <>
      <PersonalNav active="today" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} financeDue={c.cardReminders.length > 0} />
      <TodayView
        items={data.items}
        summary={data.summary}
        calendarConnected={data.calendarConnected}
        name={c.account.name}
        generatedAtISO={data.generatedAtISO}
      />
    </>
  );
}
