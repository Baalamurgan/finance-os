import { getGoogleAccessToken, googleConnectedScopes } from "./tokens";
import type { Birthday } from "./calendar";

// Read-only People API — enriches the dashboard with contacts' birthdays (and photos).
// Google birthdays often omit the year; we project each onto THIS year's occurrence for
// timeline sorting. Best-effort: any failure returns [] so the dashboard still renders.

const PEOPLE_API = "https://people.googleapis.com/v1/people/me/connections";
const CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";

export async function contactsConnected(memberId: number): Promise<boolean> {
  return (await googleConnectedScopes(memberId)).includes(CONTACTS_SCOPE);
}

type GContact = {
  names?: { displayName?: string }[];
  birthdays?: { date?: { month?: number; day?: number; year?: number } }[];
  photos?: { url?: string; default?: boolean }[];
};

/** Upcoming contact birthdays within `daysAhead`, projected to this year's occurrence. */
export async function listContactBirthdays(memberId: number, daysAhead = 30): Promise<Birthday[]> {
  const token = await getGoogleAccessToken(memberId);
  if (!token) return [];
  const params = new URLSearchParams({ personFields: "names,birthdays,photos", pageSize: "200" });
  let contacts: GContact[] = [];
  try {
    const res = await fetch(`${PEOPLE_API}?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) return [];
    contacts = ((await res.json()) as { connections?: GContact[] }).connections ?? [];
  } catch {
    return [];
  }

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + daysAhead);

  const out: Birthday[] = [];
  for (const c of contacts) {
    const bd = c.birthdays?.find((b) => b.date?.month && b.date?.day)?.date;
    if (!bd?.month || !bd?.day) continue;
    // this year's occurrence; if already passed, roll to next year (still within window?)
    let occ = new Date(today.getFullYear(), bd.month - 1, bd.day);
    if (occ < start) occ = new Date(today.getFullYear() + 1, bd.month - 1, bd.day);
    if (occ > end) continue;
    const name = c.names?.[0]?.displayName?.trim();
    if (!name) continue;
    const photo = c.photos?.find((p) => !p.default)?.url ?? null;
    out.push({ name, dateISO: occ.toISOString(), source: "contacts", photoUrl: photo });
  }
  return out;
}
