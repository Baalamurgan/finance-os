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

export type TaskList = { id: string; title: string };
export type TaskWithList = Task & { tasklistId: string; listTitle: string };

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

// Parse a Tasks API `items` payload into our Task shape (incomplete titles only).
type RawTask = { id: string; title?: string; notes?: string; due?: string; status?: string };
function toTasks(items: RawTask[] | undefined): Task[] {
  return (items ?? [])
    .filter((t) => t.title?.trim())
    .map((t) => ({ id: t.id, title: t.title!.trim(), notes: t.notes?.trim() || null, dueISO: t.due ? new Date(t.due).toISOString() : null, completed: t.status === "completed" }));
}

/** All the member's task lists. */
export async function listTasklists(memberId: number): Promise<TaskList[]> {
  const token = await getGoogleAccessToken(memberId);
  if (!token) return [];
  try {
    const res = await api(token, "/users/@me/lists?maxResults=100");
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: TaskList[] };
    return (data.items ?? []).map((l) => ({ id: l.id, title: l.title }));
  } catch {
    return [];
  }
}

/** Incomplete tasks across ALL lists, each tagged with the list it belongs to. */
export async function listAllTasks(memberId: number): Promise<{ lists: TaskList[]; tasks: TaskWithList[] }> {
  const token = await getGoogleAccessToken(memberId);
  if (!token) return { lists: [], tasks: [] };
  const lists = await listTasklists(memberId);
  if (lists.length === 0) return { lists: [], tasks: [] };
  const perList = await Promise.all(
    lists.map(async (l) => {
      try {
        const res = await api(token, `/lists/${encodeURIComponent(l.id)}/tasks?showCompleted=false&showHidden=false&maxResults=100`);
        if (!res.ok) return [];
        const data = (await res.json()) as { items?: RawTask[] };
        return toTasks(data.items).map((t) => ({ ...t, tasklistId: l.id, listTitle: l.title }));
      } catch {
        return [];
      }
    }),
  );
  return { lists, tasks: perList.flat() };
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

export async function updateTask(memberId: number, tasklistId: string, taskId: string, patch: { title?: string; dueISO?: string | null; notes?: string | null }): Promise<boolean> {
  const token = await getGoogleAccessToken(memberId);
  if (!token) return false;
  const body: Record<string, unknown> = {};
  if (patch.title != null) body.title = patch.title;
  if (patch.notes !== undefined) body.notes = patch.notes ?? "";
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
