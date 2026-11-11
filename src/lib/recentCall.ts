"use client";

// Re-use a read's answer for a short while across tab switches. The header pop-ups and bells (card used
// by family, bill due, plan due, reminders) each ask the server on mount, and every tab switch remounts
// them — Next runs server actions one at a time, so those reads queued in front of the user's own Save.
// Now each is asked at most once a minute per app session (first open still asks right away), and two
// callers of the same read share one request.
const TTL_MS = 60_000;
const memo = new Map<string, { at: number; p: Promise<unknown> }>();

export function recentCall<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p as Promise<T>;
  const p = fn();
  memo.set(key, { at: Date.now(), p });
  p.catch(() => { if (memo.get(key)?.p === p) memo.delete(key); }); // a failed read is retried next time
  return p;
}

/** Forget every cached read (e.g. on pull-to-refresh / returning to the app) so the next mount asks again. */
export function forgetRecentCalls() {
  memo.clear();
}
