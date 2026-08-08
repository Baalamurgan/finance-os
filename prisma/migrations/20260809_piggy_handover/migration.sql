-- Track whether a wound-down month's general-Piggy leftover has been physically handed
-- from the category owners to the Piggy holder. null (after wind-down) = still pending.
ALTER TABLE "Period" ADD COLUMN IF NOT EXISTS "piggyHandedOverAt" TIMESTAMP(3);

-- Backfill: existing CLOSED months are treated as already handed over, so the feature only
-- creates a pending hand-over for FUTURE wind-downs (e.g. July, once it winds down). Without
-- this, every historical month would suddenly show a pending hand-over in its following month.
UPDATE "Period"
   SET "piggyHandedOverAt" = COALESCE("closedAt", NOW())
 WHERE "status" = 'closed'
   AND "piggyHandedOverAt" IS NULL;
