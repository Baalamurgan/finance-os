import { getGoogleAccessToken, googleConnectedScopes } from "./tokens";

// Read-only Google Calendar access for the Today dashboard. Uses the member's vaulted
// access token (auto-refreshed). We fetch live and store NOTHING server-side — Google is
// the source of truth. calendar.events.readonly grants read across the user's calendars,
// so the same scope covers both their primary calendar and the Birthdays calendar.

const CAL_API = "https://www.googleapis.com/calendar/v3/calendars";
const BIRTHDAYS_CAL = "addressbook#contacts@group.v.calendar.google.com";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";

export type CalendarEvent = {
  id: string;
  title: string;
  startISO: string; // event start (date or dateTime)
  endISO: string | null;
  allDay: boolean;
  location: string | null;
  htmlLink: string | null; // deep-link to open in Google Calendar
};

export type Birthday = {
  name: string;
  dateISO: string; // the occurrence this year (for sorting on the timeline)
  source: "calendar" | "contacts";
  photoUrl?: string | null;
};

export async function calendarConnected(memberId: number): Promise<boolean> {
  return (await googleConnectedScopes(memberId)).includes(CALENDAR_SCOPE);
}

type GEvent = {
  id: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

async function fetchEvents(token: string, calendarId: string, timeMinISO: string, timeMaxISO: string): Promise<GEvent[]> {
  const params = new URLSearchParams({
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });
  const res = await fetch(`${CAL_API}/${encodeURIComponent(calendarId)}/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`calendar ${calendarId} ${res.status}`);
  const data = (await res.json()) as { items?: GEvent[] };
  return data.items ?? [];
}

function toEvent(e: GEvent): CalendarEvent {
  const startRaw = e.start?.dateTime ?? e.start?.date ?? "";
  const endRaw = e.end?.dateTime ?? e.end?.date ?? null;
  const allDay = !e.start?.dateTime;
  return {
    id: e.id,
    title: e.summary?.trim() || "(no title)",
    startISO: allDay && startRaw ? new Date(startRaw + "T00:00:00").toISOString() : new Date(startRaw).toISOString(),
    endISO: endRaw ? new Date(allDay ? endRaw + "T00:00:00" : endRaw).toISOString() : null,
    allDay,
    location: e.location?.trim() || null,
    htmlLink: e.htmlLink ?? null,
  };
}

/** Today's + the next few days' events from the member's primary calendar. */
export async function listUpcomingEvents(memberId: number, daysAhead = 7): Promise<CalendarEvent[]> {
  const token = await getGoogleAccessToken(memberId);
  if (!token) return [];
  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead).toISOString();
  try {
    const items = await fetchEvents(token, "primary", timeMin, timeMax);
    return items.map(toEvent);
  } catch {
    return [];
  }
}

/** Birthdays from Google's Birthdays calendar over the next N days. Best-effort. */
export async function listCalendarBirthdays(memberId: number, daysAhead = 30): Promise<Birthday[]> {
  const token = await getGoogleAccessToken(memberId);
  if (!token) return [];
  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead).toISOString();
  try {
    const items = await fetchEvents(token, BIRTHDAYS_CAL, timeMin, timeMax);
    return items.map((e) => ({
      name: (e.summary ?? "").replace(/'s birthday$/i, "").trim() || "Birthday",
      dateISO: new Date((e.start?.date ?? e.start?.dateTime ?? "") + (e.start?.date ? "T00:00:00" : "")).toISOString(),
      source: "calendar" as const,
    }));
  } catch {
    return []; // birthdays calendar may not be accessible — non-fatal
  }
}
