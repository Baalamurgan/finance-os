-- Money Plan: prior-month cash a member holds that became THIS month's pool income and must be handed
-- to the treasurer — budget leftover routed to income at wind-down (kind 'leftover') and/or the general
-- Piggy taken as income (kind 'piggy'). One row per holder+kind; rendered as a combined hand-over step.
CREATE TABLE IF NOT EXISTS "PoolHandover" (
  "id"           SERIAL PRIMARY KEY,
  "periodId"     INTEGER NOT NULL,
  "householdId"  INTEGER NOT NULL,
  "fromMemberId" INTEGER NOT NULL,
  "kind"         TEXT NOT NULL,
  "amount"       DOUBLE PRECISION NOT NULL,
  "detail"       TEXT,
  "handedOverAt" TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PoolHandover_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "PoolHandover_periodId_idx" ON "PoolHandover"("periodId");
CREATE UNIQUE INDEX IF NOT EXISTS "PoolHandover_periodId_fromMemberId_kind_key" ON "PoolHandover"("periodId", "fromMemberId", "kind");
