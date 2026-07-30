"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatINR } from "@/lib/format";
import { buildTimeline, buildGrouped, urgencyOf, type TodayItem, type Urgency } from "@/lib/os/timeline";
import { TodoCard } from "@/components/personal/today/TodoCard";
import { DayGrid } from "@/components/personal/today/DayGrid";
import { GoodMorning } from "@/components/personal/today/GoodMorning";
import { flushOutbox } from "@/lib/os-sync/outbox";
import { mutateTask } from "@/app/personal/os/actions";
import type { TaskWithList, TaskList } from "@/lib/integrations/google/tasks";
import type { CalendarEvent } from "@/lib/integrations/google/calendar";

type Summary = { canSpend: number | null; personalExpense: number | null };

const URGENCY_STYLE: Record<Urgency, { dot: string; text: string; chip?: string }> = {
  overdue: { dot: "bg-red-500", text: "text-red-600", chip: "bg-red-100 text-red-700" },
  now: { dot: "bg-amber-500", text: "text-amber-600", chip: "bg-amber-100 text-amber-700" },
  today: { dot: "bg-emerald-500", text: "text-emerald-700" },
  soon: { dot: "bg-slate-300", text: "text-slate-500" },
  upcoming: { dot: "bg-slate-200", text: "text-slate-400" },
};

const CACHE_KEY = "today-snapshot-v1";

export function TodayView({
  items,
  events,
  tasks,
  tasklists,
  tasksConnected,
  summary,
  calendarConnected,
  name,
  generatedAtISO,
  autoAddTodo = false,
}: {
  items: TodayItem[];
  events: CalendarEvent[];
  tasks: TaskWithList[];
  tasklists: TaskList[];
  tasksConnected: boolean;
  summary: Summary;
  calendarConnected: boolean;
  name: string;
  generatedAtISO: string;
  autoAddTodo?: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"day" | "overview">("day");
  const [view, setView] = useState<"timeline" | "grouped">("timeline");
  const [offline, setOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [snapshot, setSnapshot] = useState<{ items: TodayItem[]; at: string } | null>(null);

  // Manual sync: push any queued offline to-do changes to Google, then re-pull the whole
  // dashboard (calendar + tasks are fetched live server-side on refresh).
  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await flushOutbox(mutateTask);
      router.refresh();
      await new Promise((r) => setTimeout(r, 600));
    } finally {
      setSyncing(false);
    }
  };

  // Persist the last good payload so an offline open still shows something useful, and
  // remember the view choice.
  useEffect(() => {
    if (autoAddTodo) { setTab("day"); return; } // deep-linked "add a to-do" always lands on Day
    const t = localStorage.getItem("today-tab");
    if (t === "day" || t === "overview") setTab(t);
    const v = localStorage.getItem("today-view");
    if (v === "timeline" || v === "grouped") setView(v);
    try {
      if (items.length > 0) localStorage.setItem(CACHE_KEY, JSON.stringify({ items, at: generatedAtISO }));
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) setSnapshot(JSON.parse(raw));
    } catch {}
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, [items, generatedAtISO]);

  const setViewPersist = (v: "timeline" | "grouped") => {
    setView(v);
    localStorage.setItem("today-view", v);
  };
  const setTabPersist = (t: "day" | "overview") => {
    setTab(t);
    localStorage.setItem("today-tab", t);
  };

  // Use the live items; if we somehow rendered empty while offline, fall back to snapshot.
  const effective = items.length > 0 ? items : offline && snapshot ? snapshot.items : items;
  const now = new Date();
  const timeline = useMemo(() => buildTimeline(effective, now), [effective]);
  const grouped = useMemo(() => buildGrouped(effective, now), [effective]);

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 pb-28 sm:p-6">
      <GoodMorning name={name} canSpend={summary.canSpend} tasks={tasks} items={effective} />

      {offline && (
        <div className="rounded-lg bg-slate-100 px-4 py-2 text-xs text-slate-500">
          Offline — showing your last synced view{snapshot ? ` (${new Date(snapshot.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })})` : ""}.
        </div>
      )}

      {/* primary tabs + Sync (present on both tabs) */}
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {([["day", "Day"], ["overview", "Overview"]] as const).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTabPersist(t)}
              className={`rounded-md px-4 py-1.5 font-medium transition ${tab === t ? "bg-emerald-600 text-white" : "text-slate-500 hover:text-slate-800"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={sync}
          disabled={syncing || offline}
          title="Sync Google Calendar & Tasks"
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          <span className={syncing ? "animate-spin" : ""}>↻</span> {syncing ? "Syncing…" : "Sync"}
        </button>
      </div>

      {tab === "day" ? (
        <>
          {!calendarConnected && (
            <Link href="/personal/settings/permissions" className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-emerald-300 bg-emerald-50 px-4 py-3 hover:bg-emerald-100/70">
              <span className="text-sm font-medium text-emerald-800">Connect Google Calendar to see your schedule here</span>
              <span className="text-emerald-500">→</span>
            </Link>
          )}
          <TodoCard lists={tasklists} tasksConnected={tasksConnected} initial={tasks} autoAdd={autoAddTodo} />
          {calendarConnected && <DayGrid events={events} tasks={tasks} />}
        </>
      ) : (
        <>
          {/* Overview: everything else, in a chronological or grouped list */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
            {(["timeline", "grouped"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setViewPersist(v)}
                className={`rounded-md px-3 py-1.5 font-medium capitalize transition ${view === v ? "bg-emerald-600 text-white" : "text-slate-500 hover:text-slate-800"}`}
              >
                {v}
              </button>
            ))}
          </div>

          {effective.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
              <div className="text-4xl">🌤️</div>
              <p className="mt-2 text-sm font-medium text-slate-700">Nothing needs you right now.</p>
              <p className="text-xs text-slate-400">Bills, events and birthdays will show up here.</p>
            </div>
          ) : view === "timeline" ? (
            <ul className="space-y-2">
              {timeline.map(({ item, urgency }) => <Row key={item.id} item={item} urgency={urgency} showTime />)}
            </ul>
          ) : (
            <div className="space-y-5">
              {grouped.map((g) => (
                <section key={g.key}>
                  <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <span>{g.icon}</span> {g.label} <span className="text-slate-300">({g.items.length})</span>
                  </h2>
                  <ul className="space-y-2">
                    {g.items.map((item) => <Row key={item.id} item={item} urgency={urgencyOf(item, now)} />)}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function Row({ item, urgency, showTime }: { item: TodayItem; urgency: Urgency; showTime?: boolean }) {
  const st = URGENCY_STYLE[urgency];
  const when = item.allDay
    ? "All day"
    : new Date(item.atISO).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const dayLabel = new Date(item.atISO).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const isToday = new Date(item.atISO).toDateString() === new Date().toDateString();

  const body = (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
      <span className="text-xl leading-none">{item.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-slate-900">{item.title}</span>
          {urgency === "overdue" && st.chip && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${st.chip}`}>Overdue</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          {showTime && <span className={st.text}>{isToday ? when : `${dayLabel}${item.allDay ? "" : ` · ${when}`}`}</span>}
          {item.subtitle && <span className="truncate">{showTime ? "· " : ""}{item.subtitle}</span>}
        </div>
      </div>
      {item.amount != null && <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-700">{formatINR(item.amount)}</span>}
      {!showTime && !item.allDay && <span className={`shrink-0 text-xs ${st.text}`}>{isToday ? when : dayLabel}</span>}
    </div>
  );

  if (!item.href) return <li>{body}</li>;
  const external = item.href.startsWith("http");
  return (
    <li>
      {external ? (
        <a href={item.href} target="_blank" rel="noopener noreferrer" className="block">{body}</a>
      ) : (
        <Link href={item.href} className="block">{body}</Link>
      )}
    </li>
  );
}
