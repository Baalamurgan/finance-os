// Pure, dependency-free shaping of the Today dashboard. The aggregator (today.ts) turns
// calendar/finance/birthday facts into a flat TodayItem[]; this module orders them into the
// two views the user can toggle — a chronological Timeline and a Grouped view — and derives
// each item's urgency. Kept pure so it's unit-testable and reusable on client & server.

export type TodayKind = "event" | "bill" | "card" | "birthday" | "task";
export type Urgency = "overdue" | "now" | "today" | "soon" | "upcoming";

export type TodayItem = {
  id: string;
  kind: TodayKind;
  title: string;
  subtitle?: string | null;
  atISO: string; // when it happens / is due — the sort key
  allDay?: boolean;
  overdue?: boolean;
  amount?: number | null;
  href?: string | null;
  icon: string;
};

const HOUR = 3600_000;
const DAY = 86400_000;

function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function urgencyOf(item: TodayItem, now = new Date()): Urgency {
  const at = new Date(item.atISO).getTime();
  const delta = at - now.getTime();
  const isDue = item.kind === "bill" || item.kind === "card" || item.kind === "task";
  if (isDue && (item.overdue || delta < 0)) return "overdue";
  if (!item.allDay && delta >= 0 && delta <= 2 * HOUR) return "now";
  if (sameCalendarDay(new Date(at), now)) return "today";
  if (delta > 0 && delta <= 3 * DAY) return "soon";
  return "upcoming";
}

const URGENCY_RANK: Record<Urgency, number> = { overdue: 0, now: 1, today: 2, soon: 3, upcoming: 4 };

/** Chronological view: overdue pinned first, then everything by time ascending. */
export function buildTimeline(items: TodayItem[], now = new Date()): { item: TodayItem; urgency: Urgency }[] {
  return items
    .map((item) => ({ item, urgency: urgencyOf(item, now) }))
    .sort((a, b) => {
      const ao = a.urgency === "overdue" ? 0 : 1;
      const bo = b.urgency === "overdue" ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return new Date(a.item.atISO).getTime() - new Date(b.item.atISO).getTime();
    });
}

export type TodayGroup = { key: TodayKind; label: string; icon: string; items: TodayItem[] };

const GROUP_ORDER: { key: TodayKind; label: string; icon: string }[] = [
  { key: "bill", label: "Bills", icon: "🔔" },
  { key: "card", label: "Cards", icon: "💳" },
  { key: "event", label: "Events", icon: "📅" },
  { key: "task", label: "To-dos", icon: "✅" },
  { key: "birthday", label: "Birthdays", icon: "🎂" },
];

/** Grouped view: by kind, in a fixed priority order; within a group, most-urgent first. */
export function buildGrouped(items: TodayItem[], now = new Date()): TodayGroup[] {
  return GROUP_ORDER.map(({ key, label, icon }) => ({
    key,
    label,
    icon,
    items: items
      .filter((i) => i.kind === key)
      .sort((a, b) => {
        const ua = URGENCY_RANK[urgencyOf(a, now)];
        const ub = URGENCY_RANK[urgencyOf(b, now)];
        if (ua !== ub) return ua - ub;
        return new Date(a.atISO).getTime() - new Date(b.atISO).getTime();
      }),
  })).filter((g) => g.items.length > 0);
}
