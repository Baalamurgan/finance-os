import { listUpcomingEvents, listCalendarBirthdays, calendarConnected, type Birthday } from "@/lib/integrations/google/calendar";
import { listContactBirthdays, contactsConnected } from "@/lib/integrations/google/contacts";
import { getBillReminders } from "@/lib/billReminders";
import { getCardBillReminders, getPersonalCash } from "@/lib/personal/cash";
import type { TodayItem } from "./timeline";

// Server aggregator for the Today dashboard. Composes calendar + birthdays (Google) with
// finance facts (this app) into one flat TodayItem[] the pure timeline builder can shape.
// Everything Google is fetched live (nothing persisted); every source is independently
// guarded so one failure never blanks the dashboard. AI is NOT involved here — this is the
// deterministic layer that must also work offline from cache.

export type TodaySummary = { canSpend: number | null; personalExpense: number | null };

export type TodayData = {
  items: TodayItem[];
  summary: TodaySummary;
  calendarConnected: boolean;
  contactsConnected: boolean;
  generatedAtISO: string;
};

const normName = (s: string) => s.toLowerCase().replace(/'s birthday$/i, "").replace(/[^a-z0-9]/g, "");
const mmdd = (iso: string) => iso.slice(5, 10);

function dedupeBirthdays(lists: Birthday[][]): Birthday[] {
  const seen = new Set<string>();
  const out: Birthday[] = [];
  for (const list of lists) {
    for (const b of list) {
      const key = `${normName(b.name)}:${mmdd(b.dateISO)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(b);
    }
  }
  return out;
}

export async function getTodayData(opts: {
  memberId: number;
  householdId: number;
  personalPeriod?: { id: number; income: number; carryForward: number } | null;
}): Promise<TodayData> {
  const { memberId, householdId, personalPeriod } = opts;

  const [calOn, contactsOn, events, calBdays, contactBdays, billReminders, cardReminders, cash] = await Promise.all([
    calendarConnected(memberId),
    contactsConnected(memberId),
    listUpcomingEvents(memberId),
    listCalendarBirthdays(memberId),
    listContactBirthdays(memberId),
    getBillReminders(householdId).catch(() => []),
    getCardBillReminders(memberId).catch(() => []),
    personalPeriod ? getPersonalCash(personalPeriod).catch(() => null) : Promise.resolve(null),
  ]);

  const items: TodayItem[] = [];

  // Calendar events
  for (const e of events) {
    items.push({
      id: `ev-${e.id}`,
      kind: "event",
      title: e.title,
      subtitle: e.location,
      atISO: e.startISO,
      allDay: e.allDay,
      href: e.htmlLink,
      icon: "📅",
    });
  }

  // Family bills where this member is on the hook (responsible / head / manager)
  for (const b of billReminders) {
    if (!b.recipientIds.includes(memberId)) continue;
    items.push({
      id: `bill-${b.categoryId}`,
      kind: "bill",
      title: b.name,
      subtitle: b.overdue ? "Overdue" : "Bill due",
      atISO: b.dueISO,
      overdue: b.overdue,
      amount: b.amount,
      href: "/in-hand",
      icon: "🔔",
    });
  }

  // Personal credit-card bills coming due
  for (const c of cardReminders) {
    items.push({
      id: `card-${c.cardId}`,
      kind: "card",
      title: `${c.cardName} bill`,
      subtitle: c.overdue ? "Overdue" : "Card bill due",
      atISO: c.dueISO,
      overdue: c.overdue,
      amount: c.taggedTotal || c.ledgerOutstanding || null,
      href: "/personal/finance?tab=cards",
      icon: "💳",
    });
  }

  // Birthdays (contacts first so their photo/name wins the dedupe, then calendar)
  for (const b of dedupeBirthdays([contactBdays, calBdays])) {
    items.push({
      id: `bd-${normName(b.name)}-${mmdd(b.dateISO)}`,
      kind: "birthday",
      title: `${b.name}'s birthday`,
      subtitle: b.source === "contacts" ? "From Contacts" : "From Calendar",
      atISO: b.dateISO,
      allDay: true,
      icon: "🎂",
    });
  }

  return {
    items,
    summary: { canSpend: cash?.canSpend ?? null, personalExpense: cash?.personalExpense ?? null },
    calendarConnected: calOn,
    contactsConnected: contactsOn,
    generatedAtISO: new Date().toISOString(),
  };
}
