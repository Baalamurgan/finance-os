import type { TodayItem } from "./timeline";
import type { TaskWithList } from "@/lib/integrations/google/tasks";

// The deterministic "Good morning" briefing: turns the Today aggregation (to-dos, calendar,
// bills, cash, birthdays) into (a) a short on-screen transcript and (b) a single speech string
// for the browser's speech synthesizer. This is intentionally AI-free — when a local LLM is
// wired in later it rephrases exactly these same facts, so nothing here is throwaway.

export const BRIEFING_SECTIONS = ["todos", "eventsToday", "eventsWeek", "familyBills", "cardBills", "cash", "birthdays"] as const;
export type BriefingSection = (typeof BRIEFING_SECTIONS)[number];
export type BriefingPrefs = Record<BriefingSection, boolean>;

export const DEFAULT_BRIEFING_PREFS: BriefingPrefs = {
  todos: true,
  eventsToday: true,
  eventsWeek: true,
  familyBills: true,
  cardBills: true,
  cash: true,
  birthdays: true,
};

// What the assistant can tell you — surfaced in the settings sheet so you choose what to hear.
export const BRIEFING_OPTIONS: { key: BriefingSection; label: string; hint: string }[] = [
  { key: "todos", label: "To-dos due today", hint: "How many are due (and overdue) plus their titles" },
  { key: "eventsToday", label: "Today's schedule", hint: "Calendar events for today, with times" },
  { key: "eventsWeek", label: "The week ahead", hint: "Notable events over the next 7 days" },
  { key: "familyBills", label: "Family bills due", hint: "Bills you're on the hook for, with amounts" },
  { key: "cardBills", label: "Card bills due", hint: "Credit-card dues coming up" },
  { key: "cash", label: "Cash & spending", hint: "What's left to spend, with a low-balance alert" },
  { key: "birthdays", label: "Birthdays", hint: "Today's and upcoming birthdays" },
];

export type BriefingLine = { icon: string; text: string };
export type Briefing = { greeting: string; subtitle: string; lines: BriefingLine[]; speech: string };

export type BriefingInput = {
  name: string;
  tasks: TaskWithList[];
  items: TodayItem[];
  canSpend: number | null;
  lowCashThreshold?: number;
};

const money = (n: number) => Math.round(n).toLocaleString("en-IN");
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const timeStr = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const dayName = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { weekday: "long" });
const bdayName = (title: string) => title.replace(/'s birthday$/i, "");

export function buildBriefing(input: BriefingInput, prefs: BriefingPrefs, now: Date = new Date()): Briefing {
  const first = input.name?.split(" ")[0] ?? "";
  const h = now.getHours();
  const greetWord = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const greeting = `${greetWord}${first ? `, ${first}` : ""}.`;
  const subtitle = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  const lines: BriefingLine[] = [];
  const speech: string[] = [`${greeting} Here's your day.`];

  const today0 = startOfDay(now).getTime();
  const tomorrow0 = startOfDay(now);
  tomorrow0.setDate(tomorrow0.getDate() + 1);

  // ── To-dos due today (+ overdue) ──
  if (prefs.todos) {
    const due = input.tasks.filter((t) => !t.completed && t.dueISO && new Date(t.dueISO) < tomorrow0);
    const overdue = due.filter((t) => new Date(t.dueISO!).getTime() < today0);
    if (due.length) {
      const titles = due.slice(0, 5).map((t) => t.title);
      const more = due.length > titles.length ? "…" : "";
      const od = overdue.length ? ` · ${overdue.length} overdue` : "";
      lines.push({ icon: "✅", text: `${due.length} to-do${due.length > 1 ? "s" : ""} due today${od}: ${titles.join(", ")}${more}` });
      speech.push(`You have ${due.length} to-do${due.length > 1 ? "s" : ""} due today${overdue.length ? `, ${overdue.length} of them overdue` : ""}. ${titles.join(". ")}.`);
    } else {
      lines.push({ icon: "✅", text: "No to-dos due today." });
      speech.push("You have no to-dos due today.");
    }
  }

  const events = input.items.filter((i) => i.kind === "event");

  // ── Today's schedule ──
  if (prefs.eventsToday) {
    const todayEv = events.filter((e) => startOfDay(new Date(e.atISO)).getTime() === today0);
    if (todayEv.length) {
      const parts = todayEv.slice(0, 5).map((e) => (e.allDay ? e.title : `${e.title} at ${timeStr(e.atISO)}`));
      lines.push({ icon: "📅", text: `Today: ${parts.join("; ")}` });
      speech.push(`On your calendar today: ${parts.join(", ")}.`);
    } else {
      lines.push({ icon: "📅", text: "Your calendar is clear today." });
      speech.push("Your calendar is clear today.");
    }
  }

  // ── The week ahead ──
  if (prefs.eventsWeek) {
    const weekEnd = startOfDay(now);
    weekEnd.setDate(weekEnd.getDate() + 8);
    const upcoming = events.filter((e) => {
      const d = new Date(e.atISO);
      return d >= tomorrow0 && d < weekEnd;
    });
    if (upcoming.length) {
      const parts = upcoming.slice(0, 4).map((e) => `${e.title} on ${dayName(e.atISO)}`);
      lines.push({ icon: "🗓️", text: `This week: ${parts.join("; ")}` });
      speech.push(`Coming up this week: ${parts.join(", ")}.`);
    }
  }

  // ── Family bills ──
  if (prefs.familyBills) {
    const bills = input.items.filter((i) => i.kind === "bill");
    if (bills.length) {
      const disp = bills.map((b) => `${b.title}${b.amount ? ` ₹${money(b.amount)}` : ""}${b.overdue ? " (overdue)" : ""}`);
      const spk = bills.map((b) => `${b.title}${b.amount ? `, ${money(b.amount)} rupees` : ""}${b.overdue ? ", overdue" : ""}`);
      lines.push({ icon: "🔔", text: `Family bills: ${disp.join("; ")}` });
      speech.push(`You have ${bills.length} family bill${bills.length > 1 ? "s" : ""} to pay: ${spk.join(", ")}.`);
    }
  }

  // ── Credit-card bills ──
  if (prefs.cardBills) {
    const cards = input.items.filter((i) => i.kind === "card");
    if (cards.length) {
      const disp = cards.map((c) => `${c.title}${c.amount ? ` ₹${money(c.amount)}` : ""}${c.overdue ? " (overdue)" : ""}`);
      const spk = cards.map((c) => `${c.title}${c.amount ? `, ${money(c.amount)} rupees` : ""}${c.overdue ? ", overdue" : ""}`);
      lines.push({ icon: "💳", text: `Card bills: ${disp.join("; ")}` });
      speech.push(`Card bills due: ${spk.join(", ")}.`);
    }
  }

  // ── Cash & spending ──
  if (prefs.cash && input.canSpend != null) {
    const low = input.lowCashThreshold ?? 1000;
    if (input.canSpend < 0) {
      lines.push({ icon: "⚠️", text: `Over budget by ₹${money(-input.canSpend)} this month.` });
      speech.push(`Heads up. You're over budget by ${money(-input.canSpend)} rupees this month.`);
    } else if (input.canSpend < low) {
      lines.push({ icon: "⚠️", text: `Running low — only ₹${money(input.canSpend)} left to spend.` });
      speech.push(`Heads up, you're running low. Only ${money(input.canSpend)} rupees left to spend this month.`);
    } else {
      lines.push({ icon: "💰", text: `₹${money(input.canSpend)} left to spend this month.` });
      speech.push(`You have ${money(input.canSpend)} rupees left to spend this month.`);
    }
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
      lines.push({ icon: "🎂", text: `Birthday today: ${names.join(", ")}` });
      speech.push(`It's ${names.join(" and ")}'s birthday today.`);
    }
    if (later.length) {
      const parts = later.slice(0, 3).map((b) => `${bdayName(b.title)} on ${dayName(b.atISO)}`);
      lines.push({ icon: "🎈", text: `Upcoming birthdays: ${parts.join("; ")}` });
      speech.push(`Upcoming birthdays: ${parts.join(", ")}.`);
    }
  }

  speech.push("Have a great day.");
  return { greeting, subtitle, lines, speech: speech.join(" ") };
}
