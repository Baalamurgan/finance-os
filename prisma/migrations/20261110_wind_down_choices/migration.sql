-- Wind-down groups: saved per-month choices + the budget cut applied for last month's overspend (additive).
ALTER TABLE "Budget" ADD COLUMN "carryCut" DOUBLE PRECISION NOT NULL DEFAULT 0;
CREATE TABLE "WindDownChoice" (
  "id" SERIAL PRIMARY KEY,
  "householdId" INTEGER NOT NULL,
  "periodId" INTEGER NOT NULL,
  "categoryIds" INTEGER[] NOT NULL,
  "destination" TEXT NOT NULL DEFAULT 'piggy',
  "cuts" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "WindDownChoice_periodId_idx" ON "WindDownChoice"("periodId");
