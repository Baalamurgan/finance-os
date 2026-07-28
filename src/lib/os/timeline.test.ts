import { describe, expect, it } from "vitest";
import { buildTimeline, buildGrouped, urgencyOf, type TodayItem } from "./timeline";

const now = new Date("2026-08-01T09:00:00");
const at = (iso: string): string => new Date(iso).toISOString();

const item = (over: Partial<TodayItem>): TodayItem => ({
  id: Math.random().toString(), kind: "event", title: "x", atISO: at("2026-08-01T12:00:00"), icon: "📅", ...over,
});

describe("urgencyOf", () => {
  it("flags overdue only for due-type items", () => {
    expect(urgencyOf(item({ kind: "bill", atISO: at("2026-07-30T00:00:00"), overdue: true }), now)).toBe("overdue");
    // a past EVENT is not 'overdue' (it just already happened) — falls through to today/upcoming
    expect(urgencyOf(item({ kind: "event", atISO: at("2026-08-01T07:00:00") }), now)).toBe("today");
  });
  it("marks imminent timed items 'now', same-day 'today', within 3d 'soon'", () => {
    expect(urgencyOf(item({ atISO: at("2026-08-01T10:00:00") }), now)).toBe("now");
    expect(urgencyOf(item({ atISO: at("2026-08-01T20:00:00") }), now)).toBe("today");
    expect(urgencyOf(item({ atISO: at("2026-08-03T10:00:00") }), now)).toBe("soon");
    expect(urgencyOf(item({ atISO: at("2026-08-20T10:00:00") }), now)).toBe("upcoming");
  });
  it("all-day items are never 'now'", () => {
    expect(urgencyOf(item({ atISO: at("2026-08-01T10:00:00"), allDay: true }), now)).toBe("today");
  });
});

describe("buildTimeline", () => {
  it("pins overdue first, then chronological", () => {
    const items = [
      item({ id: "later", atISO: at("2026-08-02T10:00:00") }),
      item({ id: "overdue", kind: "bill", atISO: at("2026-07-29T00:00:00"), overdue: true }),
      item({ id: "soon", atISO: at("2026-08-01T15:00:00") }),
    ];
    expect(buildTimeline(items, now).map((x) => x.item.id)).toEqual(["overdue", "soon", "later"]);
  });
});

describe("buildGrouped", () => {
  it("groups by kind in priority order and drops empty groups", () => {
    const items = [
      item({ kind: "event" }),
      item({ kind: "bill", atISO: at("2026-08-01T00:00:00") }),
      item({ kind: "birthday", atISO: at("2026-08-01T00:00:00"), allDay: true }),
    ];
    expect(buildGrouped(items, now).map((g) => g.key)).toEqual(["bill", "event", "birthday"]);
  });
});
