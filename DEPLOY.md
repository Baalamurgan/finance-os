# Deploy guide — Family Finance OS

> **UPDATE (branch `cloud-pwa`):** the app has been **migrated to Postgres + PWA** for the
> phone apps. The authoritative steps are the **Go-live runbook** at the bottom of this file.
> The older "SQLite → Supabase" notes below are kept for reference but some have been superseded
> (e.g. Prisma 7 does **not** allow `url` in `schema.prisma` — it goes in `prisma.config.ts`).

## What changed on `cloud-pwa`
- **DB:** SQLite → **Postgres**. `schema.prisma` datasource is now just `provider = "postgresql"`;
  the connection URL lives in **`prisma.config.ts`** (`DIRECT_URL` for migrations). The app runtime
  uses the **`@prisma/adapter-pg`** adapter with the pooled **`DATABASE_URL`** (`src/lib/prisma.ts`).
- **Migrations:** real migrations now (`prisma/migrations/0_init`). Use `prisma migrate deploy` on
  prod — **never** `db push` / `db:seed` against prod (seed wipes tables; it's dev-only).
- **PWA:** `public/manifest.webmanifest` + icons + `public/sw.js` + `ServiceWorkerRegister`
  (with an update toast). Installable on Android + iOS ("Add to Home Screen").
- **Mobile:** bottom tab bar (`NavHeader` → `BottomNav`) on small screens; wide tables scroll.
- **Receipts:** deferred — the file input is hidden and `saveUpload` is a no-op (serverless fs is
  ephemeral). Re-enable via Supabase Storage later.
- **Cron:** month auto-create moved from the Mac's launchd to **Vercel Cron** (`vercel.json` →
  `/api/cron/ensure-month`, guarded by `CRON_SECRET`). Unload the local launchd agent.
- **Dev/staging separation:** use a **second Supabase project for dev**. `db:seed` / reseeds run
  ONLY against dev. Prod is migrations + the one-time `import:history`.

## Older notes (SQLite era — partially superseded)
- DB: SQLite at `./dev.db`, via the `@prisma/adapter-better-sqlite3` driver adapter (`src/lib/prisma.ts`).
- Run: `npm run dev` · seed: `npm run db:seed` · schema sync: `npx prisma db push`.

## When ready to go multi-user → Supabase Postgres

1. **Create the DB.** New Supabase project → Project Settings → Database → copy the connection
   string (use the **pooled** `:6543` "Transaction" URI for serverless; direct `:5432` for migrations).

2. **Env.** Add to `.env.local` (and the host's env):
   ```
   DATABASE_URL="postgresql://...:6543/postgres?pgbouncer=true"
   DIRECT_URL="postgresql://...:5432/postgres"
   ```

3. **Schema datasource** (`prisma/schema.prisma`):
   ```prisma
   datasource db {
     provider  = "postgresql"
     url       = env("DATABASE_URL")
     directUrl = env("DIRECT_URL")
   }
   ```
   (Prisma 7 still allows `url` for Postgres; the better-sqlite3 adapter is only for SQLite.)

4. **Client adapter** (`src/lib/prisma.ts`): swap `PrismaBetterSqlite3` for the pg adapter
   (`@prisma/adapter-pg`) or drop the adapter and let Prisma use `DATABASE_URL` directly.
   `npm i @prisma/adapter-pg pg`.

5. **Migrate:** `npx prisma migrate deploy` (switch off `db push` for prod — use real migrations so
   data is never wiped). Then `npm run db:seed` **once** to create the household/members, or import
   existing data.

6. **Auth (Google OAuth):** in Google Cloud console add the prod redirect URI
   `https://<your-domain>/api/auth/callback/google`; set `AUTH_URL`, `AUTH_SECRET`,
   `AUTH_GOOGLE_ID/SECRET` in the host env. Whitelist each family member's email on their `Member` row.

7. **Uploads:** receipt images currently write to `public/uploads/` (local fs). On a serverless host
   this is ephemeral — switch `saveUpload` (`src/app/actions.ts`) to Supabase Storage (or S3) before
   relying on receipts in prod.

## Production cautions (carry over from local)
- **Reseed is destructive** (`prisma/seed.ts` wipes all tables). Never run `db:seed` against prod
  with real data — use migrations + manual inserts.
- **Back up** before each schema change (`pg_dump` / Supabase scheduled backups).
- Mobile: the UI is responsive (condensed nav, wrapping layouts). A bottom-nav / installable PWA is
  a nice-to-have once hosted.

---

# Go-live runbook (cloud-pwa → phone apps)

**Cost:** $0 — Vercel + Supabase free tiers + free PWA install. (Only a real iOS *App Store* app
would need Apple's $99/yr; the PWA avoids that.)

### 1. Supabase (two projects: dev + prod)
- Create **two** projects (e.g. `finance-os-dev`, `finance-os-prod`). For each: Project Settings →
  Database → copy the **pooled** `:6543` URI (Transaction) and the **direct** `:5432` URI.

### 2. Env vars
- **Local `.env.local`** (points at the **dev** project):
  ```
  DATABASE_URL="postgresql://...:6543/postgres?pgbouncer=true"
  DIRECT_URL="postgresql://...:5432/postgres"
  AUTH_SECRET="<existing dev secret or a new one>"
  AUTH_GOOGLE_ID="..."  AUTH_GOOGLE_SECRET="..."
  ```
- **Vercel env** (Production) uses the **prod** project URLs + a strong `AUTH_SECRET`,
  `AUTH_URL=https://<domain>`, the Google creds, and `CRON_SECRET=<random>`.

### 3. Create schema + data
- Dev: `npx prisma migrate deploy` → `npm run db:seed` (MAR) → optionally `npm run import:history`.
- Prod (run once, against prod env): `npx prisma migrate deploy` → seed the household/members **once**
  (a trimmed seed or manual insert — do NOT run the dev `db:seed` reset against prod) →
  `npm run import:history` to load FEB–JUN.

### 4. Deploy to Vercel
- Import the GitHub repo, branch `main` (merge `cloud-pwa` first), framework = Next.js. Set env (step 2).
- Vercel auto-detects `vercel.json` → the monthly cron is registered.

### 5. Google OAuth (prod)
- Google Cloud console → add redirect `https://<domain>/api/auth/callback/google`; whitelist each
  member's email on their `Member` row.

### 6. Install on phones
- **Android (Chrome):** open the site → "Install app" prompt / menu → Add to Home screen.
- **iOS (Safari):** open the site → Share → **Add to Home Screen** → opens full-screen.
- Edits sync live (shared Postgres). The "new version — Refresh" toast appears after each deploy.

### Cutover note
Once on Postgres, retire the local launchd agent:
`launchctl unload ~/Library/LaunchAgents/com.financeos.ensure-month.plist` (Vercel Cron replaces it).

---

## Dev vs production database (do not wipe the family data)

Local development must point at a **separate dev Supabase project**, never production.

1. Create a second Supabase project (e.g. `finance-os-dev`). Copy its pooled `:6543`
   and direct `:5432` connection strings.
2. Put them in `.env.local` (see `.env.example`). Vercel's env keeps the **prod** URLs.
3. Apply schema to dev: `npx prisma migrate deploy`.
4. Seed/import against dev **only**, with the safety flag:
   `ALLOW_DB_WIPE=1 npm run db:seed` then `ALLOW_DB_WIPE=1 npm run import:real`.

**Guardrail:** `db:seed`, `import:history`, `import:real`, and `db:restore` refuse to
run unless `ALLOW_DB_WIPE=1` is set, and print which host they'd hit — so an accidental
`npm run db:seed` can never wipe production. Read-only scripts (`db:backup`,
`preview:rollover`, `ensure-month`) are unaffected. Production only ever receives
`prisma migrate deploy` + the one-time history import.

## Tests
`npm test` runs the vitest suite (settlement math, app-lock PIN/lockout, formatting).
No database needed — the money logic is unit-tested via the pure `*-core.ts` modules.
