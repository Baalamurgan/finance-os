"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutateTask, type TaskMutation } from "@/app/personal/os/actions";
import { enqueue, flushOutbox, pendingCount } from "@/lib/os-sync/outbox";
import type { TaskWithList, TaskList } from "@/lib/integrations/google/tasks";

// To-dos across ALL Google Tasks lists (each task tagged with its list). Filter by list or
// see everything grouped by list. Full minimalist CRUD: add (to a chosen list) with an
// optional due date; tap to edit title/notes/due or delete; check to complete. Online →
// straight to Google; offline → IndexedDB outbox, replayed on reconnect. (Google's API can't
// set recurrence, so no "repeat" — that's a Google-app-only field.)
const toDueISO = (d: string) => (d ? `${d}T00:00:00.000Z` : null);
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// Friendly label for a YYYY-MM-DD due date, MS-To-Do style ("Today" / "Tomorrow" / "5 Aug").
function dueLabel(d: string): string {
  if (!d) return "Due date";
  const date = new Date(`${d}T00:00:00`);
  const today = new Date(new Date().toDateString());
  const diff = Math.round((date.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function TodoCard({ lists, tasksConnected, initial }: { lists: TaskList[]; tasksConnected: boolean; initial: TaskWithList[] }) {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskWithList[]>(initial.filter((t) => !t.completed));
  const [draft, setDraft] = useState("");
  const [draftDue, setDraftDue] = useState("");
  const [draftList, setDraftList] = useState(lists[0]?.id ?? "");
  const [filter, setFilter] = useState<string>("all");
  const [showAll, setShowAll] = useState(false);
  const [queued, setQueued] = useState(0);
  const [editing, setEditing] = useState<TaskWithList | null>(null);
  const [composerOpen, setComposerOpen] = useState(false); // mobile MS-To-Do-style bottom sheet
  const [dateMenu, setDateMenu] = useState(false);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sig = initial.map((t) => t.id).join(",");
  const busy = useRef(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (composerOpen) setTimeout(() => inputRef.current?.focus(), 50);
    else setDateMenu(false);
  }, [composerOpen]);

  useEffect(() => {
    if (!draftList && lists[0]) setDraftList(lists[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists]);

  useEffect(() => {
    pendingCount().then((n) => {
      setQueued(n);
      if (n === 0 && !busy.current) setTasks(initial.filter((t) => !t.completed));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  useEffect(() => {
    const flush = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      const done = await flushOutbox(mutateTask);
      setQueued(await pendingCount());
      if (done > 0) router.refresh();
    };
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const online = () => typeof navigator === "undefined" || navigator.onLine;
  const run = async (m: TaskMutation, clientId?: string, onCreated?: (realId: string) => void) => {
    if (online()) {
      const res = await mutateTask(m).catch(() => ({ ok: false }) as const);
      if (res.ok) {
        if (m.op === "create" && "id" in res && res.id && onCreated) onCreated(res.id);
        return;
      }
    }
    await enqueue(m, clientId);
    setQueued(await pendingCount());
  };

  const add = async () => {
    const title = draft.trim();
    const listId = draftList || lists[0]?.id;
    if (!title || !listId) return;
    const dueISO = toDueISO(draftDue);
    const listTitle = lists.find((l) => l.id === listId)?.title ?? "";
    setDraft(""); setDraftDue("");
    const clientId = `local-${crypto.randomUUID()}`;
    setTasks((t) => [{ id: clientId, title, notes: null, dueISO, completed: false, tasklistId: listId, listTitle }, ...t]);
    busy.current = true;
    await run({ op: "create", tasklistId: listId, title, dueISO }, clientId, (realId) => setTasks((t) => t.map((x) => (x.id === clientId ? { ...x, id: realId } : x))));
    busy.current = false;
  };

  const complete = async (task: TaskWithList) => {
    setTasks((t) => t.filter((x) => x.id !== task.id));
    busy.current = true;
    await run({ op: "complete", tasklistId: task.tasklistId, taskId: task.id });
    busy.current = false;
  };

  const saveEdit = async (patch: { title: string; notes: string; due: string }) => {
    if (!editing) return;
    const id = editing.id;
    const next = { ...editing, title: patch.title.trim(), notes: patch.notes.trim() || null, dueISO: toDueISO(patch.due) };
    setTasks((t) => t.map((x) => (x.id === id ? next : x)));
    setEditing(null);
    busy.current = true;
    await run({ op: "update", tasklistId: next.tasklistId, taskId: id, title: next.title, notes: next.notes, dueISO: next.dueISO });
    busy.current = false;
  };

  const remove = async () => {
    if (!editing) return;
    const { id, tasklistId } = editing;
    setTasks((t) => t.filter((x) => x.id !== id));
    setEditing(null);
    busy.current = true;
    await run({ op: "delete", tasklistId, taskId: id });
    busy.current = false;
  };

  const fmtDue = (iso: string) => {
    const d = new Date(iso);
    return { label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }), overdue: d < new Date(new Date().toDateString()) };
  };

  // "Due today or earlier" — the agenda for the Day tab. dueISO is a UTC date; comparing
  // against tomorrow's local midnight cleanly captures today + anything overdue.
  const tomorrow = new Date(new Date().toDateString());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dueToday = (t: TaskWithList) => t.dueISO != null && new Date(t.dueISO) < tomorrow;
  const todays = tasks.filter(dueToday).sort((a, b) => (a.dueISO ?? "").localeCompare(b.dueISO ?? ""));

  // The full backlog (all lists, exactly as before) — lives in a collapsible section.
  const shown = filter === "all" ? tasks : tasks.filter((t) => t.tasklistId === filter);
  const groups = lists
    .map((l) => ({ list: l, items: shown.filter((t) => t.tasklistId === l.id) }))
    .filter((g) => g.items.length > 0);

  const TaskRow = (t: TaskWithList) => {
    const due = t.dueISO ? fmtDue(t.dueISO) : null;
    return (
      <li key={t.id} className="flex items-center gap-3 py-2.5">
        <button onClick={() => complete(t)} aria-label="Complete" className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button onClick={() => setEditing(t)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm text-slate-800">{t.title}</span>
          {t.notes && <span className="block truncate text-xs text-slate-400">{t.notes}</span>}
        </button>
        {due && <span className={`shrink-0 text-[11px] font-medium ${due.overdue ? "text-red-600" : "text-slate-400"}`}>{due.overdue ? "overdue · " : ""}{due.label}</span>}
      </li>
    );
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">✅ To-dos for today</h2>
        {queued > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">{queued} queued</span>}
      </div>

      {!tasksConnected ? (
        <Link href="/personal/settings/permissions" className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-emerald-300 bg-emerald-50 px-3 py-2.5 hover:bg-emerald-100/70">
          <span className="text-sm font-medium text-emerald-800">Connect Google Tasks to manage to-dos here</span>
          <span className="text-emerald-500">→</span>
        </Link>
      ) : (
        <>
          {/* Desktop: inline add form */}
          <form onSubmit={(e) => { e.preventDefault(); add(); }} className="mb-3 hidden flex-wrap gap-2 sm:flex">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a to-do…" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
            <input type="date" value={draftDue} onChange={(e) => setDraftDue(e.target.value)} title="Due date (optional)" className="rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-600 outline-none focus:border-emerald-400" />
            {lists.length > 1 && (
              <select value={draftList} onChange={(e) => setDraftList(e.target.value)} title="Add to list" className="rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-600 outline-none">
                {lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
              </select>
            )}
            <button type="submit" disabled={!draft.trim() || lists.length === 0} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">Add</button>
          </form>

          {/* Mobile: MS-To-Do-style bottom composer, opened from a docked "＋ Add a to-do" pill */}
          <button
            onClick={() => setComposerOpen(true)}
            className="mb-3 flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-emerald-700 sm:hidden"
          >
            <span className="text-lg leading-none">＋</span> Add a to-do
          </button>

          {/* Today's agenda: due today or overdue, across every list */}
          {todays.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-400">Nothing due today. Nice.</p>
          ) : (
            <ul className="divide-y divide-slate-100">{todays.map(TaskRow)}</ul>
          )}

          {/* Full backlog (every list) — tucked away so the Day view stays focused on today */}
          <div className="mt-3 border-t border-slate-100 pt-2">
            <button
              onClick={() => setShowAll((s) => !s)}
              className="flex w-full items-center justify-between text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              <span>All to-dos <span className="text-slate-300">({tasks.length})</span></span>
              <span className={`transition ${showAll ? "rotate-180" : ""}`}>⌄</span>
            </button>

            {showAll && (
              <div className="mt-2">
                {lists.length > 1 && (
                  <select value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-2 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 outline-none">
                    <option value="all">All lists</option>
                    {lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                  </select>
                )}
                {shown.length === 0 ? (
                  <p className="py-3 text-center text-xs text-slate-400">No open to-dos here.</p>
                ) : filter === "all" ? (
                  <div className="space-y-3">
                    {groups.map((g) => (
                      <div key={g.list.id}>
                        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.list.title} <span className="text-slate-300">({g.items.length})</span></h3>
                        <ul className="divide-y divide-slate-100">{g.items.map(TaskRow)}</ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">{shown.map(TaskRow)}</ul>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {editing && <EditModal task={editing} onClose={() => setEditing(null)} onSave={saveEdit} onDelete={remove} />}

      {mounted && composerOpen && createPortal(
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/30 sm:hidden" onClick={() => setComposerOpen(false)}>
          <div
            className="rounded-t-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
          >
            <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-slate-200" />

            {/* quick-action chips */}
            <div className="flex items-center gap-2 px-4 pt-3">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDateMenu((m) => !m)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${draftDue ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"}`}
                >
                  📅 {dueLabel(draftDue)}
                  {draftDue && <span onClick={(e) => { e.stopPropagation(); setDraftDue(""); }} className="ml-0.5 text-slate-400">✕</span>}
                </button>
                {dateMenu && (
                  <div className="absolute bottom-full left-0 z-10 mb-2 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                    {([["Today", 0], ["Tomorrow", 1], ["Next week", 7]] as const).map(([label, off]) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => { const d = new Date(new Date().toDateString()); d.setDate(d.getDate() + off); setDraftDue(ymd(d)); setDateMenu(false); }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                      >
                        {label}
                      </button>
                    ))}
                    <label className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                      Pick a date
                      <input type="date" value={draftDue} onChange={(e) => { setDraftDue(e.target.value); setDateMenu(false); }} className="w-0 opacity-0" />
                    </label>
                  </div>
                )}
              </div>

              {lists.length > 1 && (
                <div className="flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500">
                  📋
                  <select value={draftList} onChange={(e) => setDraftList(e.target.value)} className="max-w-[8rem] truncate bg-transparent outline-none">
                    {lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* text input + send */}
            <form
              onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { add(); inputRef.current?.focus(); } }}
              className="flex items-center gap-2 px-4 py-3"
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-slate-300" />
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                enterKeyHint="done"
                placeholder="Add a to-do…"
                className="min-w-0 flex-1 text-base text-slate-900 outline-none placeholder:text-slate-400"
              />
              <button
                type="submit"
                disabled={!draft.trim() || lists.length === 0}
                aria-label="Add"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-600 text-white disabled:opacity-30"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}

function EditModal({ task, onClose, onSave, onDelete }: { task: TaskWithList; onClose: () => void; onSave: (p: { title: string; notes: string; due: string }) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [due, setDue] = useState(toDateInput(task.dueISO));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-bold text-slate-900">Edit to-do <span className="text-xs font-normal text-slate-400">· {task.listTitle}</span></h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (title.trim()) onSave({ title, notes, due }); }} className="space-y-3 px-5 py-4">
          <div>
            <label className="text-xs font-medium text-slate-500">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required className="input mt-1 w-full" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional details" className="input mt-1 w-full resize-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Due date</label>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="input mt-1 w-full" />
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <button type="button" onClick={onDelete} className="rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">Delete</button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
              <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Save</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
