-- Funding advances: a member (Phase 1) or a budget category (Phase 2) fronts cash to a member who'd
-- otherwise be short for a Money-Plan step. Idempotent so it's safe to re-run.
CREATE TABLE IF NOT EXISTS "Advance" (
  "id"             SERIAL PRIMARY KEY,
  "periodId"       INTEGER NOT NULL REFERENCES "Period"("id"),
  "fromMemberId"   INTEGER,
  "fromCategoryId" INTEGER,
  "toMemberId"     INTEGER NOT NULL,
  "amount"         DOUBLE PRECISION NOT NULL,
  "day"            INTEGER,
  "note"           TEXT,
  "settled"        BOOLEAN NOT NULL DEFAULT false,
  "settledAt"      TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "Advance_periodId_idx" ON "Advance"("periodId");
