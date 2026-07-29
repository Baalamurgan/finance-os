// Delete a whole Google Tasks list (and its tasks) by name. Used to drop the "Routine" list
// after moving recurring routines to Google Calendar. Reads the member's Google token from
// the encrypted vault (same as import-mstodo). Dry-run by default.
//
//   npm run tasklist:delete -- --name="Routine"            # dry run — shows what it'd remove
//   npm run tasklist:delete -- --name="Routine" --commit   # actually delete the list

import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { createDecipheriv } from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { OAuth2Client } from "google-auth-library";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const NAME = args.find((a) => a.startsWith("--name="))?.slice("--name=".length) ?? null;
const EMAIL = args.find((a) => a.startsWith("--email="))?.slice("--email=".length) ?? null;

function decrypt(payload: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, "base64");
  const buf = Buffer.from(payload, "base64");
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

async function googleToken(): Promise<string> {
  const where = EMAIL ? { provider: "google", member: { email: { equals: EMAIL, mode: "insensitive" as const } } } : { provider: "google" };
  const rows = await prisma.integration.findMany({ where, include: { member: { select: { email: true } } } });
  if (rows.length === 0) throw new Error("No Google integration found.");
  if (rows.length > 1) throw new Error(`Multiple Google integrations — pass --email. Found: ${rows.map((r) => r.member.email).join(", ")}`);
  const client = new OAuth2Client({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET });
  client.setCredentials({ refresh_token: decrypt(rows[0].refreshTokenEnc!) });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Could not mint an access token.");
  return token;
}

const TASKS = "https://tasks.googleapis.com/tasks/v1";
async function g<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${TASKS}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

async function main() {
  if (!NAME) throw new Error('Pass --name="List name".');
  const token = await googleToken();
  const lists = (await g<{ items?: { id: string; title: string }[] }>(token, "/users/@me/lists?maxResults=100")).items ?? [];
  const target = lists.find((l) => l.title.trim().toLowerCase() === NAME.trim().toLowerCase());
  if (!target) throw new Error(`No Google Tasks list named "${NAME}". Have: ${lists.map((l) => l.title).join(", ")}`);

  // count tasks (paginated) for the confirmation
  let count = 0, pageToken: string | undefined;
  do {
    const data = await g<{ items?: unknown[]; nextPageToken?: string }>(token, `/lists/${encodeURIComponent(target.id)}/tasks?showCompleted=true&showHidden=true&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`);
    count += (data.items ?? []).length;
    pageToken = data.nextPageToken;
  } while (pageToken);

  console.log(`\nList "${target.title}" has ${count} task(s).`);
  if (!COMMIT) {
    console.log(`Dry run — nothing deleted. Re-run with --commit to delete the whole list.\n`);
    return;
  }
  await g(token, `/users/@me/lists/${encodeURIComponent(target.id)}`, { method: "DELETE" });
  console.log(`✓ Deleted list "${target.title}" and its ${count} task(s).\n`);
}

main().catch((e) => { console.error("\n✗", e instanceof Error ? e.message : e, "\n"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
