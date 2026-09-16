-- Head-set manual ordering of Money-Plan steps (move up/down). One row per reordered step; sortIndex
-- overrides the derived (day/rank) order in the plan's final sort.
CREATE TABLE "StepOrderOverride" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "stepKey" TEXT NOT NULL,
    "sortIndex" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "StepOrderOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StepOrderOverride_periodId_stepKey_key" ON "StepOrderOverride"("periodId", "stepKey");

ALTER TABLE "StepOrderOverride" ADD CONSTRAINT "StepOrderOverride_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
