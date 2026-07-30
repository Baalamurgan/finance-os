import { describe, expect, it } from "vitest";
import { buildBriefing, DEFAULT_BRIEFING_PREFS, type BriefingInput } from "./briefing";
import type { TodayItem } from "./timeline";
import type { TaskWithList } from "@/lib/integrations/google/tasks";

const now = new Date("2026-07-30T08:00:00");
const iso = (s: string) => new Date(s).toISOString();

const task = (over: Partial<TaskWithList>): TaskWithList => ({
  id: Math.random().toString(), title: "t", notes: null, dueISO: null, completed: false, tasklistId: "l", listTitle: "L", ...over,
});
const item = (over: Partial<TodayItem>): TodayItem => ({
  id: Math.random().toString(), kind: "event", title: "x", atISO: iso("2026-07-30T12:00:00"), icon: "📅", ...over,
});

const base: BriefingInput = { name: "Bala Kumar", tasks: [], events: [], items: [], canSpend: null };

describe("buildBriefing", () => {
  it("greets by first name and the right part of day", () => {
    expect(buildBriefing(base, DEFAULT_BRIEFING_PREFS, now).greeting).toBe("Good morning, Bala.");
    expect(buildBriefing(base, DEFAULT_BRIEFING_PREFS, new Date("2026-07-30T15:00:00")).greeting).toBe("Good afternoon, Bala.");
  });

  it("counts to-dos due today and flags overdue", () => {
    const input: BriefingInput = {
      ...base,
      tasks: [task({ title: "Pay rent", dueISO: iso("2026-07-30T00:00:00") }), task({ title: "Old thing", dueISO: iso("2026-07-27T00:00:00") }), task({ title: "Future", dueISO: iso("2026-08-05T00:00:00") })],
    };
    const b = buildBriefing(input, DEFAULT_BRIEFING_PREFS, now);
    expect(b.speech).toContain("2 things to do today");
    expect(b.speech).toContain("overdue");
    expect(b.speech).not.toContain("Future");
  });

  it("only mentions non-routine events, ignoring recurring routine", () => {
    const input: BriefingInput = {
      ...base,
      events: [
        { title: "Wind down", startISO: iso("2026-07-30T22:00:00"), allDay: false, recurring: true },
        { title: "Dentist", startISO: iso("2026-07-30T16:00:00"), allDay: false, recurring: false },
      ],
    };
    const b = buildBriefing(input, DEFAULT_BRIEFING_PREFS, now);
    expect(b.speech).toContain("Dentist");
    expect(b.speech).not.toContain("Wind down");
    expect(b.speech).toContain("Apart from your usual routine");
  });

  it("says nothing-out-of-ordinary when the only events are routine", () => {
    const input: BriefingInput = { ...base, events: [{ title: "Wind down", startISO: iso("2026-07-30T22:00:00"), allDay: false, recurring: true }] };
    expect(buildBriefing(input, DEFAULT_BRIEFING_PREFS, now).speech).toContain("just your usual routine");
  });

  it("warns when running low on cash and reports amount otherwise", () => {
    expect(buildBriefing({ ...base, canSpend: 500 }, DEFAULT_BRIEFING_PREFS, now).speech).toContain("running a bit low");
    expect(buildBriefing({ ...base, canSpend: 25000 }, DEFAULT_BRIEFING_PREFS, now).speech).toContain("25,000 rupees left");
    expect(buildBriefing({ ...base, canSpend: -300 }, DEFAULT_BRIEFING_PREFS, now).speech).toContain("over budget");
  });

  it("announces a birthday today", () => {
    const input: BriefingInput = { ...base, items: [item({ kind: "birthday", title: "Amma's birthday", atISO: iso("2026-07-30T00:00:00"), allDay: true })] };
    expect(buildBriefing(input, DEFAULT_BRIEFING_PREFS, now).speech).toContain("Amma's birthday today");
  });

  it("announces the family wind-down when it's near", () => {
    expect(buildBriefing({ ...base, windDown: { daysUntil: 2 } }, DEFAULT_BRIEFING_PREFS, now).speech).toContain("wind-down is in 2 days");
    expect(buildBriefing({ ...base, windDown: { daysUntil: 1 } }, DEFAULT_BRIEFING_PREFS, now).speech).toContain("wind-down is tomorrow");
    expect(buildBriefing({ ...base, windDown: null }, DEFAULT_BRIEFING_PREFS, now).speech).not.toContain("wind-down");
  });

  it("respects section prefs (cash off → no cash line)", () => {
    const b = buildBriefing({ ...base, canSpend: 500 }, { ...DEFAULT_BRIEFING_PREFS, cash: false }, now);
    expect(b.speech).not.toContain("running low");
  });
});
