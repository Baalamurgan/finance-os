"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutateTask, type TaskMutation } from "@/app/personal/os/actions";
import { enqueue, flushOutbox, pendingCount } from "@/lib/os-sync/outbox";
import type { Task } from "@/lib/integrations/google/tasks";

// To-dos & reminders card. Google Tasks is the source of truth; changes go straight there
// when online, and into the IndexedDB outbox (replayed on reconnect) when offline. UI is
// optimistic so it feels instant either way.
export function TodoCard({
  tasklistId,
  tasksConnected,
  initial,
}: {
  tasklistId: string | null;
  tasksConnected: boolean;
  initial: Task[];
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>(initial.filter((t) => !t.completed));
  const [draft, setDraft] = useState("");
  const [queued, setQueued] = useState(0);
  const sig = initial.map((t) => t.id).join(",");
  const busy = useRef(false);

  // Re-sync from the server's authoritative list when it changes — but not while we have
  // un-flushed local changes (would clobber optimistic state).
  useEffect(() => {
    pendingCount().then((n) => {
      setQueued(n);
      if (n === 0 && !busy.current) setTasks(initial.filter((t) => !t.completed));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Flush any queued offline changes on mount and whenever we come back online.
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

  // Run a mutation online (direct) or stash it offline. clientId links an offline create to
  // its later complete/delete before it has a real Google id.
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
    setDraft("");
    const clientId = `local-${crypto.randomUUID()}`;
    setTasks((t) => [{ id: clientId, title, notes: null, dueISO: null, completed: false }, ...t]);
    busy.current = true;
    await run({ op: "create", tasklistId, title }, clientId, (realId) =>
      setTasks((t) => t.map((x) => (x.id === clientId ? { ...x, id: realId } : x))),
    );
    busy.current = false;
  };

  const complete = async (task: Task) => {
    if (!tasklistId) return;
    setTasks((t) => t.filter((x) => x.id !== task.id));
    busy.current = true;
    await run({ op: "complete", tasklistId, taskId: task.id });
    busy.current = false;
  };

  const fmtDue = (iso: string) => {
    const d = new Date(iso);
    const overdue = d < new Date(new Date().toDateString());
    return { label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }), overdue };
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
          <form
            onSubmit={(e) => { e.preventDefault(); add(); }}
            className="mb-2 flex gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a to-do…"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
            <button type="submit" disabled={!draft.trim() || !tasklistId} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
              Add
            </button>
          </form>

          {tasks.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-400">No open to-dos. Nice.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tasks.map((t) => {
                const due = t.dueISO ? fmtDue(t.dueISO) : null;
                return (
                  <li key={t.id} className="flex items-center gap-3 py-2.5">
                    <button
                      onClick={() => complete(t)}
                      aria-label="Complete"
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{t.title}</span>
                    {due && (
                      <span className={`shrink-0 text-[11px] font-medium ${due.overdue ? "text-red-600" : "text-slate-400"}`}>
                        {due.overdue ? "overdue · " : ""}{due.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
