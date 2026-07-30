import type { TodayItem } from "./timeline";
import type { TaskWithList } from "@/lib/integrations/google/tasks";

// The deterministic "Good morning" briefing: turns the Today aggregation (to-dos, calendar,
// bills, cash, birthdays) into (a) a short on-screen transcript and (b) speech for the browser's
// speech synthesizer. Each line carries its own `speech` so the UI can start reading from any
// line you tap. Intentionally AI-free — when a local LLM is wired in later it rephrases exactly
// these same facts, so nothing here is throwaway. Calendar routine (recurring events) is filtered
// out: you only hear what's different from a normal day.

export const BRIEFING_SECTIONS = ["todos", "eventsToday", "eventsWeek", "familyBills", "cardBills", "cash", "windDown", "birthdays"] as const;
export type BriefingSection = (typeof BRIEFING_SECTIONS)[number];
export type BriefingPrefs = Record<BriefingSection, boolean>;

export const DEFAULT_BRIEFING_PREFS: BriefingPrefs = {
  todos: true,
  eventsToday: true,
  eventsWeek: true,
  familyBills: true,
  cardBills: true,
  cash: true,
  windDown: true,
  birthdays: true,
};

// What the assistant can tell you — surfaced in the settings sheet so you choose what to hear.
export const BRIEFING_OPTIONS: { key: BriefingSection; label: string; hint: string }[] = [
  { key: "todos", label: "To-dos due today", hint: "How many are due (and overdue) plus their titles" },
  { key: "eventsToday", label: "Today's schedule", hint: "Only events that aren't your usual routine" },
  { key: "eventsWeek", label: "The week ahead", hint: "Non-routine events over the next 7 days" },
  { key: "familyBills", label: "Family bills due", hint: "Bills you're on the hook for, with amounts" },
  { key: "cardBills", label: "Card bills due", hint: "Credit-card dues coming up" },
  { key: "cash", label: "Cash & spending", hint: "What's left to spend, with a low-balance alert" },
  { key: "windDown", label: "Family wind-down", hint: "A heads-up as the monthly family close approaches" },
  { key: "birthdays", label: "Birthdays", hint: "Today's and upcoming birthdays" },
];

export type BriefEvent = { title: string; startISO: string; allDay: boolean; recurring: boolean };
export type BriefingLine = { icon: string; text: string; speech: string };
export type Briefing = { greeting: string; subtitle: string; intro: string; outro: string; lines: BriefingLine[]; speech: string };

export type BriefingInput = {
  name: string;
  tasks: TaskWithList[];
  events: BriefEvent[]; // today + next ~7 days, each flagged recurring (routine) or not
  items: TodayItem[]; // used for bills / cards / birthdays
  canSpend: number | null;
  windDown?: { daysUntil: number } | null; // family monthly close, if it's near
  lowCashThreshold?: number;
};

const money = (n: number) => Math.round(n).toLocaleString("en-IN");
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const timeStr = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const dayName = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { weekday: "long" });
const bdayName = (title: string) => title.replace(/'s birthday$/i, "");
const andList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function buildBriefing(input: BriefingInput, prefs: BriefingPrefs, now: Date = new Date()): Briefing {
  const first = input.name?.split(" ")[0] ?? "";
  const h = now.getHours();
  const greetWord = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const greeting = `${greetWord}${first ? `, ${first}` : ""}.`;
  const subtitle = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  const intro = `${greetWord}${first ? `, ${first}` : ""}! Here's how your day's looking.`;
  const outro = "That's everything — go have a great one!";

  const lines: BriefingLine[] = [];
  const push = (icon: string, text: string, speech: string) => lines.push({ icon, text, speech });

  const today0 = startOfDay(now).getTime();
  const tomorrow0 = startOfDay(now);
  tomorrow0.setDate(tomorrow0.getDate() + 1);

  // ── To-dos due today (+ overdue) ──
  if (prefs.todos) {
    const due = input.tasks.filter((t) => !t.completed && t.dueISO && new Date(t.dueISO) < tomorrow0);
    const overdue = due.filter((t) => new Date(t.dueISO!).getTime() < today0);
    if (due.length) {
      const titles = due.slice(0, 5).map((t) => t.title);
      const more = due.length - titles.length;
      const od = overdue.length ? ` · ${overdue.length} overdue` : "";
      push("✅", `${due.length} to-do${due.length > 1 ? "s" : ""} today${od}: ${titles.join(", ")}${more > 0 ? `, +${more} more` : ""}`,
        `You've got ${due.length} thing${due.length > 1 ? "s" : ""} to do today${overdue.length ? `, and ${overdue.length} ${overdue.length > 1 ? "are" : "is"} already overdue` : ""}. ${andList(titles)}.${more > 0 ? ` Plus ${more} more.` : ""}`);
    } else {
      push("✅", "No to-dos due today.", "You're all clear on to-dos today. Nice.");
    }
  }

  // Split the week's events into today vs. later, and routine vs. one-off.
  const todayEvents = input.events.filter((e) => startOfDay(new Date(e.startISO)).getTime() === today0);
  const laterEvents = input.events.filter((e) => {
    const d = new Date(e.startISO);
    return d >= tomorrow0;
  });

  // ── Today's schedule — only what's different from a normal day ──
  if (prefs.eventsToday) {
    const oneOff = todayEvents.filter((e) => !e.recurring);
    const routine = todayEvents.filter((e) => e.recurring);
    if (oneOff.length) {
      const parts = oneOff.slice(0, 5).map((e) => (e.allDay ? e.title : `${e.title} at ${timeStr(e.startISO)}`));
      push("📅", `Not routine today: ${parts.join("; ")}`,
        `${routine.length ? "Apart from your usual routine, you've" : "Today you've"} got ${andList(parts)}.`);
    } else if (routine.length) {
      push("📅", "Nothing outside your usual routine today.", "Nothing out of the ordinary today — just your usual routine.");
    } else {
      push("📅", "Your calendar's clear today.", "Your calendar's totally clear today.");
    }
  }

  // ── The week ahead (non-routine only) ──
  if (prefs.eventsWeek) {
    const upcoming = laterEvents.filter((e) => !e.recurring);
    if (upcoming.length) {
      const parts = upcoming.slice(0, 4).map((e) => `${e.title} on ${dayName(e.startISO)}`);
      push("🗓️", `Later this week: ${parts.join("; ")}`, `Later this week, keep an eye on ${andList(parts)}.`);
    }
  }

  // ── Family bills ──
  if (prefs.familyBills) {
    const bills = input.items.filter((i) => i.kind === "bill");
    if (bills.length) {
      const disp = bills.map((b) => `${b.title}${b.amount ? ` ₹${money(b.amount)}` : ""}${b.overdue ? " (overdue)" : ""}`);
      const spk = bills.map((b) => `${b.title}${b.amount ? `, ${money(b.amount)} rupees` : ""}${b.overdue ? ", which is overdue" : ""}`);
      push("🔔", `Family bills: ${disp.join("; ")}`, `Don't forget, you've got ${bills.length} family bill${bills.length > 1 ? "s" : ""} to pay: ${andList(spk)}.`);
    }
  }

  // ── Credit-card bills ──
  if (prefs.cardBills) {
    const cards = input.items.filter((i) => i.kind === "card");
    if (cards.length) {
      const disp = cards.map((c) => `${c.title}${c.amount ? ` ₹${money(c.amount)}` : ""}${c.overdue ? " (overdue)" : ""}`);
      const spk = cards.map((c) => `${c.title}${c.amount ? `, ${money(c.amount)} rupees` : ""}${c.overdue ? ", overdue" : ""}`);
      push("💳", `Card bills: ${disp.join("; ")}`, `Heads up on card bills: ${andList(spk)}.`);
    }
  }

  // ── Cash & spending ──
  if (prefs.cash && input.canSpend != null) {
    const low = input.lowCashThreshold ?? 1000;
    if (input.canSpend < 0) {
      push("⚠️", `Over budget by ₹${money(-input.canSpend)} this month.`, `Quick heads up — you're over budget by ${money(-input.canSpend)} rupees this month. Might want to ease off.`);
    } else if (input.canSpend < low) {
      push("⚠️", `Running low — only ₹${money(input.canSpend)} left to spend.`, `You're running a bit low — only ${money(input.canSpend)} rupees left to spend this month.`);
    } else {
      push("💰", `₹${money(input.canSpend)} left to spend this month.`, `You've got ${money(input.canSpend)} rupees left to spend this month.`);
    }
  }

  // ── Family wind-down (monthly close) approaching ──
  if (prefs.windDown && input.windDown) {
    const d = input.windDown.daysUntil;
    const when = d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
    push("🌙", `Family wind-down ${when}.`, `Also, the family wind-down is ${when} — a good time to settle up before the month closes.`);
  }

  // ── Birthdays (today + next 7 days) ──
  if (prefs.birthdays) {
    const soonEnd = startOfDay(now);
    soonEnd.setDate(soonEnd.getDate() + 8);
    const relevant = input.items.filter((i) => {
      if (i.kind !== "birthday") return false;
      const d = startOfDay(new Date(i.atISO)).getTime();
      return d >= today0 && d < soonEnd.getTime();
    });
    const todays = relevant.filter((b) => startOfDay(new Date(b.atISO)).getTime() === today0);
    const later = relevant.filter((b) => startOfDay(new Date(b.atISO)).getTime() !== today0);
    if (todays.length) {
      const names = todays.map((b) => bdayName(b.title));
      push("🎂", `Birthday today: ${names.join(", ")}`, `Oh, and it's ${andList(names)}'s birthday today — don't forget to wish ${names.length > 1 ? "them" : "them"}!`);
    }
    if (later.length) {
      const parts = later.slice(0, 3).map((b) => `${bdayName(b.title)}'s birthday on ${dayName(b.atISO)}`);
      push("🎈", `Upcoming birthdays: ${parts.join("; ")}`, `Coming up: ${andList(parts)}.`);
    }
  }

  const speech = [intro, ...lines.map((l) => l.speech), outro].join(" ");
  return { greeting, subtitle, intro, outro, lines, speech };
}
