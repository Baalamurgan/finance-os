-- Activity log + chit-fund detail. Additive only.
ALTER TABLE "Loan" ADD COLUMN "chitWonInstallment" INTEGER;
ALTER TABLE "Loan" ADD COLUMN "chitPotAmount" DOUBLE PRECISION;
ALTER TABLE "Loan" ADD COLUMN "interestRate" DOUBLE PRECISION;
ALTER TABLE "Loan" ADD COLUMN "note" TEXT;

ALTER TABLE "LoanPayment" ADD COLUMN "dividend" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE "ActivityLog" (
    "id" SERIAL NOT NULL,
    "householdId" INTEGER NOT NULL,
    "memberId" INTEGER,
    "memberName" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "periodId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivityLog_householdId_createdAt_idx" ON "ActivityLog"("householdId", "createdAt");
