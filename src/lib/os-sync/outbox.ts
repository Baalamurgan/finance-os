import type { TaskMutation, TaskMutationResult } from "@/app/personal/os/actions";

// Offline write queue for Google Tasks. When a to-do change can't reach Google (offline, or
// a failed request), we stash the mutation in IndexedDB and replay it — in order — on the
// next reconnect / app open. Google Tasks stays the source of truth; this is purely a
// durable outbox so offline edits aren't lost. Browser-only (guards for SSR).

const DB_NAME = "personal-os";
const STORE = "task-outbox";
const VERSION = 1;

export type OutboxEntry = { id: string; ts: number; mutation: TaskMutation; clientId?: string };

function hasIDB(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(mutation: TaskMutation, clientId?: string): Promise<void> {
  if (!hasIDB()) return;
  const id = crypto.randomUUID();
  await tx("readwrite", (s) => s.put({ id, ts: Date.now(), mutation, clientId } satisfies OutboxEntry));
}

export async function allEntries(): Promise<OutboxEntry[]> {
  if (!hasIDB()) return [];
  const rows = (await tx<OutboxEntry[]>("readonly", (s) => s.getAll())) ?? [];
  return rows.sort((a, b) => a.ts - b.ts);
}

export async function pendingCount(): Promise<number> {
  return (await allEntries()).length;
}

async function removeEntry(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

/**
 * Replay queued mutations in order via `runner` (the mutateTask server action). Stops at the
 * first failure so ordering is preserved for the next attempt. Rewrites a taskId that refers
 * to a still-unsynced offline-created task (clientId) to its real id once the create lands.
 * Returns how many flushed successfully.
 */
export async function flushOutbox(runner: (m: TaskMutation) => Promise<TaskMutationResult>): Promise<number> {
  if (!hasIDB()) return 0;
  const entries = await allEntries();
  const idMap = new Map<string, string>(); // clientId → real Google task id
  let done = 0;
  for (const e of entries) {
    let m = e.mutation;
    if ("taskId" in m && idMap.has(m.taskId)) m = { ...m, taskId: idMap.get(m.taskId)! };
    let res: TaskMutationResult;
    try {
      res = await runner(m);
    } catch {
      break; // network died mid-flush — leave the rest queued
    }
    if (!res.ok) break;
    if (m.op === "create" && e.clientId && res.id) idMap.set(e.clientId, res.id);
    await removeEntry(e.id);
    done++;
  }
  return done;
}
