-- Head-set per-month day override for Money-plan steps with no row of their own to hold a date:
-- periodic/fund bills (date otherwise from category config) and the Piggy hand-over (date otherwise
-- derived from the wind-down date). Deleted (not stored null) when reverted to the derived date.
CREATE TABLE IF NOT EXISTS "StepDayOverride" (
  "id"       SERIAL PRIMARY KEY,
  "periodId" INTEGER NOT NULL,
  "stepKey"  TEXT NOT NULL,
  "day"      INTEGER NOT NULL,
  CONSTRAINT "StepDayOverride_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "StepDayOverride_periodId_stepKey_key" ON "StepDayOverride"("periodId", "stepKey");
