-- One-off "skip this month's set-aside" for a bill-with-a-fund category: its presence means
-- don't put the set-aside on that period's sheet and don't accrue it at wind-down.
CREATE TABLE "SetAsideSkip" (
  "id"          SERIAL PRIMARY KEY,
  "householdId" INTEGER NOT NULL,
  "categoryId"  INTEGER NOT NULL,
  "periodId"    INTEGER NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SetAsideSkip_categoryId_periodId_key" ON "SetAsideSkip"("categoryId", "periodId");
CREATE INDEX "SetAsideSkip_periodId_idx" ON "SetAsideSkip"("periodId");
