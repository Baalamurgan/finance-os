-- Money Plan: head-editable steps that survive a plan refresh.
--   ManualPlanStep — an ad-hoc member→member (or ↔ hub) move inserted between two steps.
--   HiddenPlanStep — a derived step removed from the plan VIEW only (Sheet untouched); delete to un-hide.
CREATE TABLE IF NOT EXISTS "ManualPlanStep" (
  "id"           SERIAL PRIMARY KEY,
  "periodId"     INTEGER NOT NULL,
  "fromMemberId" INTEGER NOT NULL,
  "toMemberId"   INTEGER NOT NULL,
  "amount"       DOUBLE PRECISION NOT NULL,
  "afterStepKey" TEXT,
  "day"          INTEGER,
  "note"         TEXT,
  "done"         BOOLEAN NOT NULL DEFAULT false,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManualPlanStep_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ManualPlanStep_periodId_idx" ON "ManualPlanStep"("periodId");

CREATE TABLE IF NOT EXISTS "HiddenPlanStep" (
  "id"       SERIAL PRIMARY KEY,
  "periodId" INTEGER NOT NULL,
  "stepKey"  TEXT NOT NULL,
  CONSTRAINT "HiddenPlanStep_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "HiddenPlanStep_periodId_stepKey_key" ON "HiddenPlanStep"("periodId", "stepKey");
