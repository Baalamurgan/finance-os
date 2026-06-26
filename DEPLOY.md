# Deploy guide — Family Finance OS

**Status:** running **local-first on SQLite** for now (July go-live is local). When the family
needs to log in from their phones, migrate to **Supabase Postgres**. This doc makes that a small,
scripted change. Nothing here is required while running locally.

## Current local setup (unchanged)
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
