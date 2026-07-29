"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutateTask, type TaskMutation } from "@/app/personal/os/actions";
import { enqueue, flushOutbox, pendingCount } from "@/lib/os-sync/outbox";
import type { Task } from "@/lib/integrations/google/tasks";

// To-dos & reminders card — full (minimalist) CRUD over Google Tasks. Add with an optional
// due date; tap a to-do to edit its title/notes/due or delete it; check to complete. Online
// changes go straight to Google; offline they queue in the IndexedDB outbox and replay on
// reconnect. Optimistic UI throughout. (Note: Google's API can't set recurrence, so there's
// no "repeat" here — that's a Google-app-only field.)
const toDueISO = (d: string) => (d ? `${d}T00:00:00.000Z` : null);
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export function TodoCard({ tasklistId, tasksConnected, initial }: { tasklistId: string | null; tasksConnected: boolean; initial: Task[] }) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>(initial.filter((t) => !t.completed));
  const [draft, setDraft] = useState("");
  const [draftDue, setDraftDue] = useState("");
  const [queued, setQueued] = useState(0);
  const [editing, setEditing] = useState<Task | null>(null);
  const sig = initial.map((t) => t.id).join(",");
  const busy = useRef(false);

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
    if (!title || !tasklistId) return;
    const dueISO = toDueISO(draftDue);
    setDraft(""); setDraftDue("");
    const clientId = `local-${crypto.randomUUID()}`;
    setTasks((t) => [{ id: clientId, title, notes: null, dueISO, completed: false }, ...t]);
    busy.current = true;
    await run({ op: "create", tasklistId, title, dueISO }, clientId, (realId) => setTasks((t) => t.map((x) => (x.id === clientId ? { ...x, id: realId } : x))));
    busy.current = false;
  };

  const complete = async (task: Task) => {
    if (!tasklistId) return;
    setTasks((t) => t.filter((x) => x.id !== task.id));
    busy.current = true;
    await run({ op: "complete", tasklistId, taskId: task.id });
    busy.current = false;
  };

  const saveEdit = async (patch: { title: string; notes: string; due: string }) => {
    if (!tasklistId || !editing) return;
    const id = editing.id;
    const next = { ...editing, title: patch.title.trim(), notes: patch.notes.trim() || null, dueISO: toDueISO(patch.due) };
    setTasks((t) => t.map((x) => (x.id === id ? next : x)));
    setEditing(null);
    busy.current = true;
    await run({ op: "update", tasklistId, taskId: id, title: next.title, notes: next.notes, dueISO: next.dueISO });
    busy.current = false;
  };

  const remove = async () => {
    if (!tasklistId || !editing) return;
    const id = editing.id;
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

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">✅ To-dos</h2>
        {queued > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">{queued} queued offline</span>}
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
            <button type="submit" disabled={!draft.trim() || !tasklistId} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">Add</button>
          </form>

          {tasks.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-400">No open to-dos. Nice.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tasks.map((t) => {
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
              })}
            </ul>
          )}
        </>
      )}

      {editing && <EditModal task={editing} onClose={() => setEditing(null)} onSave={saveEdit} onDelete={remove} />}
    </section>
  );
}

function EditModal({ task, onClose, onSave, onDelete }: { task: Task; onClose: () => void; onSave: (p: { title: string; notes: string; due: string }) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [due, setDue] = useState(toDateInput(task.dueISO));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-bold text-slate-900">Edit to-do</h2>
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
