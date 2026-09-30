-- CreateTable: recurring "money move" template behind the personal Money Plan (transfer | save).
CREATE TABLE "PersonalPlanItem" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "dayOfMonth" INTEGER,
    "fromAccountId" INTEGER,
    "toAccountId" INTEGER,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalPlanItem_memberId_idx" ON "PersonalPlanItem"("memberId");

-- AddForeignKey
ALTER TABLE "PersonalPlanItem" ADD CONSTRAINT "PersonalPlanItem_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalPlanItem" ADD CONSTRAINT "PersonalPlanItem_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "FinanceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalPlanItem" ADD CONSTRAINT "PersonalPlanItem_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "FinanceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
