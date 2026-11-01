// Month-end countdown from a clock reading (IST, matching how spends are routed to months). Pure so the
// wind-down popup/banner can compute it from the DEVICE clock on the phone: a server-rendered value can be
// stale (a page cached offline by the service worker days ago would still say "September ends in 4 days").
export type MonthEndInfo = { daysUntil: number; lastDay: number; monthLabel: string; dateStr: string };

export function monthEndInfo(nowMs: number): MonthEndInfo {
  const ist = new Date(nowMs + 330 * 60000); // IST = UTC+5:30
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth(); // 0-indexed
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(y, m, lastDay));
  return {
    daysUntil: lastDay - ist.getUTCDate(),
    lastDay,
    monthLabel: ist.toLocaleString("en-US", { month: "long", timeZone: "UTC" }),
    dateStr: end.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }),
  };
}

export const MONTH_END_WINDOW_DAYS = 5;
