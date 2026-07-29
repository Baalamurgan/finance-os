"use client";

import { useEffect, useRef, useState } from "react";
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

export function TodoCard({ lists, tasksConnected, initial }: { lists: TaskList[]; tasksConnected: boolean; initial: TaskWithList[] }) {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskWithList[]>(initial.filter((t) => !t.completed));
  const [draft, setDraft] = useState("");
  const [draftDue, setDraftDue] = useState("");
  const [draftList, setDraftList] = useState(lists[0]?.id ?? "");
  const [filter, setFilter] = useState<string>("all");
  const [queued, setQueued] = useState(0);
  const [editing, setEditing] = useState<TaskWithList | null>(null);
  const sig = initial.map((t) => t.id).join(",");
  const busy = useRef(false);

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

  const shown = filter === "all" ? tasks : tasks.filter((t) => t.tasklistId === filter);
  // group by list, in the lists' own order, for the "all" view
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
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">✅ To-dos</h2>
        <div className="flex items-center gap-2">
          {queued > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">{queued} queued</span>}
          {tasksConnected && lists.length > 1 && (
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 outline-none">
              <option value="all">All lists</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
          )}
        </div>
      </div>

      {!tasksConnected ? (
        <Link href="/personal/settings/permissions" className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-emerald-300 bg-emerald-50 px-3 py-2.5 hover:bg-emerald-100/70">
          <span className="text-sm font-medium text-emerald-800">Connect Google Tasks to manage to-dos here</span>
          <span className="text-emerald-500">→</span>
        </Link>
      ) : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); add(); }} className="mb-2 flex flex-wrap gap-2">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a to-do…" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
            <input type="date" value={draftDue} onChange={(e) => setDraftDue(e.target.value)} title="Due date (optional)" className="rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-600 outline-none focus:border-emerald-400" />
            {lists.length > 1 && (
              <select value={draftList} onChange={(e) => setDraftList(e.target.value)} title="Add to list" className="rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-600 outline-none">
                {lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
              </select>
            )}
            <button type="submit" disabled={!draft.trim() || lists.length === 0} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">Add</button>
          </form>

          {shown.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-400">No open to-dos here. Nice.</p>
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
        </>
      )}

      {editing && <EditModal task={editing} onClose={() => setEditing(null)} onSave={saveEdit} onDelete={remove} />}
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
