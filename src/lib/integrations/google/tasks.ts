import { getGoogleAccessToken, googleConnectedScopes } from "./tokens";

// Google Tasks is the SOURCE OF TRUTH for to-dos & reminders — we store none of them. Read
// live; writes go straight to the Tasks API (queued in an IndexedDB outbox when offline, see
// src/lib/os-sync). The `tasks` scope covers read + write.

const TASKS_API = "https://tasks.googleapis.com/tasks/v1";
const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

export type Task = {
  id: string;
  title: string;
  notes: string | null;
  dueISO: string | null; // Google stores date-only; time is unreliable
  completed: boolean;
};

export async function tasksConnected(memberId: number): Promise<boolean> {
  return (await googleConnectedScopes(memberId)).includes(TASKS_SCOPE);
}

async function api(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${TASKS_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
}

/** The member's default task list id (Tasks always has at least one list). */
export async function defaultTasklistId(memberId: number): Promise<string | null> {
  const token = await getGoogleAccessToken(memberId);
  if (!token) return null;
  try {
    const res = await api(token, "/users/@me/lists?maxResults=10");
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: { id: string }[] };
    return data.items?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** Incomplete tasks from a list (defaults to the member's first list). */
export async function listTasks(memberId: number, tasklistId?: string): Promise<{ tasklistId: string | null; tasks: Task[] }> {
  const token = await getGoogleAccessToken(memberId);
  if (!token) return { tasklistId: null, tasks: [] };
  const listId = tasklistId ?? (await defaultTasklistId(memberId));
  if (!listId) return { tasklistId: null, tasks: [] };
  try {
    const res = await api(token, `/lists/${encodeURIComponent(listId)}/tasks?showCompleted=false&showHidden=false&maxResults=100`);
    if (!res.ok) return { tasklistId: listId, tasks: [] };
    const data = (await res.json()) as { items?: { id: string; title?: string; notes?: string; due?: string; status?: string }[] };
    const tasks: Task[] = (data.items ?? [])
      .filter((t) => t.title?.trim())
      .map((t) => ({
        id: t.id,
        title: t.title!.trim(),
        notes: t.notes?.trim() || null,
        dueISO: t.due ? new Date(t.due).toISOString() : null,
        completed: t.status === "completed",
      }));
    return { tasklistId: listId, tasks };
  } catch {
    return { tasklistId: listId, tasks: [] };
  }
}

// ── Mutations (used by the server action; the client never calls Google directly) ──────
export async function createTask(memberId: number, tasklistId: string, input: { title: string; dueISO?: string | null; notes?: string | null }): Promise<string | null> {
  const token = await getGoogleAccessToken(memberId);
  if (!token) return null;
  const body: Record<string, unknown> = { title: input.title };
  if (input.notes) body.notes = input.notes;
  if (input.dueISO) body.due = input.dueISO;
  const res = await api(token, `/lists/${encodeURIComponent(tasklistId)}/tasks`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) return null;
  return ((await res.json()) as { id?: string }).id ?? null;
}

export async function completeTask(memberId: number, tasklistId: string, taskId: string): Promise<boolean> {
  const token = await getGoogleAccessToken(memberId);
  if (!token) return false;
  const res = await api(token, `/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "completed" }),
  });
  return res.ok;
}

export async function updateTask(memberId: number, tasklistId: string, taskId: string, patch: { title?: string; dueISO?: string | null }): Promise<boolean> {
  const token = await getGoogleAccessToken(memberId);
  if (!token) return false;
  const body: Record<string, unknown> = {};
  if (patch.title != null) body.title = patch.title;
  if (patch.dueISO !== undefined) body.due = patch.dueISO; // null clears the due date
  const res = await api(token, `/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return res.ok;
}

export async function deleteTask(memberId: number, tasklistId: string, taskId: string): Promise<boolean> {
  const token = await getGoogleAccessToken(memberId);
  if (!token) return false;
  const res = await api(token, `/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
  return res.ok;
}
