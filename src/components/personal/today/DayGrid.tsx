"use client";

import { useEffect, useRef, useState } from "react";
import type { CalendarEvent } from "@/lib/integrations/google/calendar";
import type { Task } from "@/lib/integrations/google/tasks";

// A Google-Calendar-style day view (00:00 → 23:59) of today's schedule: timed events laid
// out on an hour grid (overlaps split into side-by-side lanes), all-day events + today's
// to-dos in a strip on top, and a live "now" line. Read-only — tap an event to open it in
// Google Calendar. Editing to-dos happens in the To-dos card above.

const HOUR_H = 56; // px per hour
const GUTTER = 52; // px for the time labels

const minutesInto = (iso: string, dayStart: Date) => Math.max(0, Math.min(1440, (new Date(iso).getTime() - dayStart.getTime()) / 60000));

type Placed = { ev: CalendarEvent; top: number; height: number; leftPct: number; widthPct: number };

// Split overlapping events into lanes within each overlap cluster (so nothing hides).
function layout(events: CalendarEvent[], dayStart: Date): Placed[] {
  const timed = events
    .filter((e) => !e.allDay)
    .map((e) => ({ e, start: minutesInto(e.startISO, dayStart), end: Math.max(minutesInto(e.startISO, dayStart) + 25, e.endISO ? minutesInto(e.endISO, dayStart) : minutesInto(e.startISO, dayStart) + 30) }))
    .sort((a, b) => a.start - b.start);

  const placed: Placed[] = [];
  let i = 0;
  while (i < timed.length) {
    // grow a cluster while events keep overlapping
    let clusterEnd = timed[i].end;
    let j = i + 1;
    while (j < timed.length && timed[j].start < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, timed[j].end);
      j++;
    }
    const cluster = timed.slice(i, j);
    const laneEnds: number[] = [];
    const laneOf = cluster.map((c) => {
      let lane = laneEnds.findIndex((end) => end <= c.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(c.end); } else laneEnds[lane] = c.end;
      return lane;
    });
    const lanes = laneEnds.length;
    cluster.forEach((c, k) => {
      placed.push({
        ev: c.e,
        top: (c.start / 60) * HOUR_H,
        height: ((c.end - c.start) / 60) * HOUR_H,
        leftPct: (laneOf[k] / lanes) * 100,
        widthPct: 100 / lanes,
      });
    });
    i = j;
  }
  return placed;
}

export function DayGrid({ events, tasks }: { events: CalendarEvent[]; tasks: Task[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowMin, setNowMin] = useState(0);
  const dayStart = new Date(new Date().toDateString());

  useEffect(() => {
    const tick = () => setNowMin((Date.now() - new Date(new Date().toDateString()).getTime()) / 60000);
    tick();
    const id = setInterval(tick, 60000);
    // scroll so the current time sits near the top third
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (new Date().getHours() - 1) * HOUR_H);
    return () => clearInterval(id);
  }, []);

  const placed = layout(events, dayStart);
  const allDay = events.filter((e) => e.allDay);
  const todayStr = new Date().toDateString();
  const dueToday = tasks.filter((t) => t.dueISO && new Date(t.dueISO).toDateString() === todayStr);
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {/* all-day strip: all-day events + today's dated to-dos */}
      {(allDay.length > 0 || dueToday.length > 0) && (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-slate-50/60 px-3 py-2">
          {allDay.map((e) => (
            <Chip key={e.id} href={e.htmlLink} className="bg-indigo-100 text-indigo-700">📅 {e.title}</Chip>
          ))}
          {dueToday.map((t) => (
            <Chip key={t.id} className="bg-emerald-100 text-emerald-700">✅ {t.title}</Chip>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="relative max-h-[62vh] overflow-y-auto">
        <div className="relative" style={{ height: 24 * HOUR_H }}>
          {/* hour lines + labels */}
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="absolute inset-x-0 border-t border-slate-100" style={{ top: h * HOUR_H }}>
              <span className="absolute -top-2 left-0 w-[46px] pr-1 text-right text-[10px] tabular-nums text-slate-300">
                {h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
              </span>
            </div>
          ))}

          {/* now line */}
          <div className="absolute z-20 flex items-center" style={{ top: (nowMin / 60) * HOUR_H, left: GUTTER - 6, right: 8 }}>
            <span className="h-2 w-2 rounded-full bg-red-500" />
            <span className="h-px flex-1 bg-red-500/70" />
          </div>

          {/* events */}
          <div className="absolute inset-y-0" style={{ left: GUTTER, right: 8 }}>
            {placed.map(({ ev, top, height, leftPct, widthPct }) => {
              const body = (
                <div className="flex h-full flex-col overflow-hidden rounded-md border-l-2 border-indigo-500 bg-indigo-50 px-2 py-0.5 text-indigo-900">
                  <span className="truncate text-xs font-semibold leading-tight">{ev.title}</span>
                  {height > 30 && <span className="truncate text-[10px] text-indigo-600/80">{fmt(ev.startISO)}{ev.location ? ` · ${ev.location}` : ""}</span>}
                </div>
              );
              return (
                <div key={ev.id} className="absolute px-0.5" style={{ top, height: Math.max(20, height - 2), left: `${leftPct}%`, width: `${widthPct}%` }}>
                  {ev.htmlLink ? <a href={ev.htmlLink} target="_blank" rel="noopener noreferrer" className="block h-full">{body}</a> : body}
                </div>
              );
            })}
          </div>

          {placed.length === 0 && allDay.length === 0 && (
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-slate-400">
              Nothing scheduled today.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ children, className, href }: { children: React.ReactNode; className: string; href?: string | null }) {
  const cls = `max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`;
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{children}</a> : <span className={cls}>{children}</span>;
}
