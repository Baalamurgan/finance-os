// The household lives in IST (UTC+5:30). The server runtime is UTC (Vercel), so any "what month is
// it now?" computed from a raw `new Date()` on the server lags 5.5 hours — just after midnight IST on
// the 1st, a UTC clock is still in the previous month, which made the app render the new month as a
// "next-month draft". Everyone in the family is in India, so IST is their device time AND the single
// consistent basis a SHARED ledger needs (the current month can't vary per viewer's clock). Use these
// for every current-month decision on the server so it matches the device the family actually uses.
const IST_OFFSET_MS = 330 * 60000; // +5:30

export function istNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + IST_OFFSET_MS);
}

// Current { year, month } (month 1–12) in IST.
export function istYearMonth(now: Date = new Date()): { year: number; month: number } {
  const ist = istNow(now);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1 };
}

// Full IST calendar parts, for logic that also needs the day/time (e.g. wind-down at 23:59).
export function istDateParts(now: Date = new Date()): {
  year: number; month: number; day: number; hour: number; minute: number;
} {
  const ist = istNow(now);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1,
    day: ist.getUTCDate(),
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
  };
}

// Start of TODAY in IST, built with the server's LOCAL Date constructor so it pairs with due dates built
// the same way (new Date(year, month-1, day)) for day-count / overdue math. A raw new Date() on the UTC
// server lags to the previous calendar day until 05:30 IST — which made "today" steps read as tomorrow.
export function istTodayStart(now: Date = new Date()): Date {
  const p = istDateParts(now);
  return new Date(p.year, p.month - 1, p.day);
}
export function istTodayStartMs(now: Date = new Date()): number {
  return istTodayStart(now).getTime();
}

// Today's IST date as "YYYY-MM-DD" (the Analysis heatmaps).
export function istTodayISO(now: Date = new Date()): string {
  return istNow(now).toISOString().slice(0, 10);
}

// The IST calendar day ("YYYY-MM-DD") a stored instant falls on.
export function istDayOf(d: Date): string {
  return istNow(d).toISOString().slice(0, 10);
}

// "YYYY-MM-DD" → the instant that IST day starts (stored as a spend's spentOn). null if malformed.
export function istDayStart(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null; // e.g. 31 Feb
  return new Date(t - IST_OFFSET_MS);
}

// A family spend's day: the picked spend date, else the day it was logged.
export function spendDay(s: { spentOn?: Date | null; createdAt: Date }): string {
  return istDayOf(s.spentOn ?? s.createdAt);
}
