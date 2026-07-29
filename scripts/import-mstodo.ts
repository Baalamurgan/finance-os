// One-time migration: Microsoft To Do  →  Google Tasks.
//
// You export your To Do data from Microsoft's Graph Explorer (no app registration) and drop
// the JSON into scripts/data/mstodo/ ; this script maps it and creates matching lists + tasks
// in YOUR Google Tasks, using the Google token you already authorized in the app (read from
// the encrypted Integration vault). Nothing is stored in our DB — Google Tasks is the truth.
//
// INPUT (scripts/data/mstodo/):
//   lists.json            = the raw response of:  GET /me/todo/lists
//   <List name>.json      = the raw response of:  GET /me/todo/lists/{listId}/tasks
//                           (one file per list, named after the list's displayName)
//
// USAGE:
//   npm run import:mstodo                 # DRY RUN — shows the plan, writes nothing
//   npm run import:mstodo -- --commit     # actually create the lists + tasks
//   flags: --active-only  --email=you@gmail.com  --dir=scripts/data/mstodo
//
// By default EVERYTHING is imported; completed items are created already-completed (they land
// in Google Tasks' "Completed" section). --active-only skips completed.
// Safe to re-run: a task whose title already exists in the target Google list is skipped.

import { config } from "dotenv";
config({ path: ".env.local" }); // ENCRYPTION_KEY + AUTH_GOOGLE_* live here
config(); // .env (DATABASE_URL) — fills anything not already set
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, basename } from "path";
import { createDecipheriv } from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { OAuth2Client } from "google-auth-library";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const ACTIVE_ONLY = args.includes("--active-only"); // default imports everything, preserving completed
const EMAIL = args.find((a) => a.startsWith("--email="))?.slice("--email=".length) ?? null;
const DIR = args.find((a) => a.startsWith("--dir="))?.slice("--dir=".length) ?? "scripts/data/mstodo";

// ── AES-256-GCM decrypt (mirrors src/lib/crypto.ts) ────────────────────────────
function decrypt(payload: string): string {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY missing");
  const key = Buffer.from(raw, "base64");
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ── Resolve the member + a Google access token from the vault ──────────────────
async function googleToken(): Promise<{ memberId: number; token: string }> {
  const where = EMAIL
    ? { provider: "google", member: { email: { equals: EMAIL, mode: "insensitive" as const } } }
    : { provider: "google" };
  const rows = await prisma.integration.findMany({ where, include: { member: { select: { id: true, email: true } } } });
  if (rows.length === 0) throw new Error("No Google integration found. Connect Google Tasks in the app first.");
  if (rows.length > 1) throw new Error(`Multiple Google integrations — pass --email=<the one you want>. Found: ${rows.map((r) => r.member.email).join(", ")}`);
  const row = rows[0];
  if (!row.refreshTokenEnc) throw new Error("Google integration has no refresh token — reconnect Google in the app.");
  const client = new OAuth2Client({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET });
  client.setCredentials({ refresh_token: decrypt(row.refreshTokenEnc) });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Could not mint a Google access token from the stored refresh token.");
  return { memberId: row.member.id, token };
}

// ── Google Tasks API ───────────────────────────────────────────────────────────
const TASKS = "https://tasks.googleapis.com/tasks/v1";
async function g<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${TASKS}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Google Tasks ${init?.method ?? "GET"} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

type GList = { id: string; title: string };
async function listTasklists(token: string): Promise<GList[]> {
  return (await g<{ items?: GList[] }>(token, "/users/@me/lists?maxResults=100")).items ?? [];
}
async function createTasklist(token: string, title: string): Promise<GList> {
  return g<GList>(token, "/users/@me/lists", { method: "POST", body: JSON.stringify({ title }) });
}
async function listTaskTitles(token: string, listId: string): Promise<Set<string>> {
  const data = await g<{ items?: { title?: string }[] }>(token, `/lists/${encodeURIComponent(listId)}/tasks?showCompleted=true&showHidden=true&maxResults=100`);
  return new Set((data.items ?? []).map((t) => (t.title ?? "").trim().toLowerCase()).filter(Boolean));
}
async function createTask(token: string, listId: string, t: GoogleTask): Promise<void> {
  const body: Record<string, unknown> = { title: t.title };
  if (t.notes) body.notes = t.notes;
  if (t.due) body.due = t.due;
  if (t.completed) {
    body.status = "completed";
    body.completed = t.completedISO ?? new Date().toISOString(); // → Google's "Completed" section
  }
  await g(token, `/lists/${encodeURIComponent(listId)}/tasks`, { method: "POST", body: JSON.stringify(body) });
}

// ── Microsoft To Do input parsing ───────────────────────────────────────────────
type MsTask = {
  title?: string;
  status?: string;
  body?: { content?: string; contentType?: string };
  dueDateTime?: { dateTime?: string };
  completedDateTime?: { dateTime?: string };
};
type MsList = { id: string; displayName: string };
type GoogleTask = { title: string; notes?: string; due?: string; completed: boolean; completedISO?: string };

const sanitize = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toLowerCase();
const stripHtml = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function loadInput(): { list: MsList; tasks: MsTask[] }[] {
  const listsPath = join(DIR, "lists.json");
  if (!existsSync(listsPath)) throw new Error(`Missing ${listsPath}. Save the GET /me/todo/lists response there.`);
  const lists = readJson<{ value?: MsList[] }>(listsPath).value ?? [];
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "lists.json");

  // A tasks file belongs to a list if its (sanitized) name equals the list name, or the
  // list name followed by digits — so multi-page exports like "Tasks-2.json" merge in.
  const out: { list: MsList; tasks: MsTask[] }[] = [];
  for (const list of lists) {
    const key = sanitize(list.displayName);
    const matches = files.filter((f) => {
      const s = sanitize(basename(f, ".json"));
      return s === key || (s.startsWith(key) && /^\d+$/.test(s.slice(key.length)));
    });
    if (matches.length === 0) {
      console.warn(`  ⚠︎  no tasks file for list "${list.displayName}" (expected ${list.displayName}.json) — skipping`);
      continue;
    }
    const tasks: MsTask[] = [];
    for (const file of matches) {
      const parsed = readJson<{ value?: MsTask[]; "@odata.nextLink"?: string }>(join(DIR, file));
      if (parsed["@odata.nextLink"]) console.warn(`  ⚠︎  "${file}" still has an @odata.nextLink — a later page is missing.`);
      tasks.push(...(parsed.value ?? []));
    }
    out.push({ list, tasks });
  }
  return out;
}

function toGoogle(t: MsTask): GoogleTask | null {
  const title = t.title?.trim();
  if (!title) return null;
  const notes = t.body?.content ? (t.body.contentType === "html" ? stripHtml(t.body.content) : t.body.content.trim()) : "";
  const dueDate = t.dueDateTime?.dateTime ? t.dueDateTime.dateTime.slice(0, 10) : null; // YYYY-MM-DD
  const completed = t.status === "completed";
  const completedISO = t.completedDateTime?.dateTime ? new Date(t.completedDateTime.dateTime).toISOString() : undefined;
  return {
    title,
    ...(notes ? { notes } : {}),
    ...(dueDate ? { due: `${dueDate}T00:00:00.000Z` } : {}),
    completed,
    ...(completedISO ? { completedISO } : {}),
  };
}

// ── Run ─────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nMicrosoft To Do → Google Tasks  ${COMMIT ? "(COMMIT — will write)" : "(dry run — no writes)"}\n`);
  const input = loadInput();
  const { token } = await googleToken();
  const existingLists = await listTasklists(token);
  const listByTitle = new Map(existingLists.map((l) => [l.title.trim().toLowerCase(), l]));

  let created = 0, skipped = 0, listsMade = 0;

  for (const { list, tasks } of input) {
    const all = tasks.map(toGoogle).filter((x): x is GoogleTask => x != null);
    const usable = ACTIVE_ONLY ? all.filter((t) => !t.completed) : all;
    const activeCount = usable.filter((t) => !t.completed).length;
    const completedCount = usable.length - activeCount;

    console.log(`\n📋 ${list.displayName}  (${activeCount} active${completedCount ? `, ${completedCount} completed` : ""})`);

    let target = listByTitle.get(list.displayName.trim().toLowerCase()) ?? null;
    if (!target) {
      if (COMMIT) {
        target = await createTasklist(token, list.displayName);
        listByTitle.set(list.displayName.trim().toLowerCase(), target);
      }
      listsMade++;
      console.log(`   ${COMMIT ? "＋ created" : "＋ would create"} Google Tasks list "${list.displayName}"`);
    }

    const existingTitles = target ? await listTaskTitles(token, target.id) : new Set<string>();
    for (const task of usable) {
      if (existingTitles.has(task.title.toLowerCase())) {
        skipped++;
        continue;
      }
      if (COMMIT && target) await createTask(token, target.id, task);
      existingTitles.add(task.title.toLowerCase());
      created++;
      console.log(`   ${COMMIT ? "✓" : "·"} ${task.completed ? "☑" : "☐"} ${task.title}${task.due ? `  (due ${task.due.slice(0, 10)})` : ""}`);
    }
  }

  console.log(`\n${COMMIT ? "Done" : "Plan"}: ${created} task${created === 1 ? "" : "s"} ${COMMIT ? "created" : "to create"}, ${skipped} already present (skipped), ${listsMade} list${listsMade === 1 ? "" : "s"} ${COMMIT ? "created" : "to create"}.`);
  if (!COMMIT) console.log(`\nRe-run with  --commit  to apply.\n`);
}

main()
  .catch((e) => {
    console.error("\n✗", e instanceof Error ? e.message : e, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
