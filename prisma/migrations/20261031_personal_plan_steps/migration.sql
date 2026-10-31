-- PersonalPlanStep: this month's materialised, executable Money-Plan steps (income / transfer / save),
-- generated from the recurring templates + one-offs, each carrying an explicit done state. New table only.

-- CreateTable
CREATE TABLE "PersonalPlanStep" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "dayOfMonth" INTEGER,
    "fromAccountId" INTEGER,
    "toAccountId" INTEGER,
    "note" TEXT,
    "templateKind" TEXT,
    "templateId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "doneAt" TIMESTAMP(3),
    "transferOutId" INTEGER,
    "transferInId" INTEGER,
    "savingsId" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalPlanStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonalPlanStep_periodId_templateKind_templateId_key" ON "PersonalPlanStep"("periodId", "templateKind", "templateId");

-- CreateIndex
CREATE INDEX "PersonalPlanStep_memberId_periodId_idx" ON "PersonalPlanStep"("memberId", "periodId");

-- AddForeignKey
ALTER TABLE "PersonalPlanStep" ADD CONSTRAINT "PersonalPlanStep_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalPlanStep" ADD CONSTRAINT "PersonalPlanStep_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PersonalPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
