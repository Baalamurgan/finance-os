// The Google integrations a member can grant, each independently (least-privilege).
// `scope` is the single OAuth scope that integration needs; the permissions UI requests
// exactly one at a time via incremental consent, so nothing is bundled.
export type GoogleIntegrationKey = "calendar" | "tasks" | "contacts";

export type GoogleIntegrationDef = {
  key: GoogleIntegrationKey;
  label: string;
  icon: string;
  scope: string;
  why: string; // shown in the UI — why we ask
  privacy: string; // plain-language privacy note
};

export const GOOGLE_INTEGRATIONS: GoogleIntegrationDef[] = [
  {
    key: "calendar",
    label: "Google Calendar",
    icon: "📅",
    scope: "https://www.googleapis.com/auth/calendar.events.readonly",
    why: "Show today's schedule and upcoming events on your Today dashboard.",
    privacy: "Read-only. We never create or change events — editing opens Google Calendar itself.",
  },
  {
    key: "tasks",
    label: "Google Tasks",
    icon: "✅",
    scope: "https://www.googleapis.com/auth/tasks",
    why: "Your to-dos and reminders live in Google Tasks; we read and update them here.",
    privacy: "Read/write to your task lists only. Tasks stay in your Google account — we store none of them.",
  },
  {
    key: "contacts",
    label: "Google Contacts",
    icon: "👥",
    scope: "https://www.googleapis.com/auth/contacts.readonly",
    why: "Surface birthdays and who's who alongside your calendar.",
    privacy: "Read-only. Used only to enrich birthdays/names on the dashboard.",
  },
];

export const GOOGLE_INTEGRATION_BY_KEY = new Map(GOOGLE_INTEGRATIONS.map((g) => [g.key, g]));
export const GOOGLE_SCOPE_TO_KEY = new Map(GOOGLE_INTEGRATIONS.map((g) => [g.scope, g.key]));
