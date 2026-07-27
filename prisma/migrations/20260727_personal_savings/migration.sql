-- Personal savings pot (personal-mode analogue of the family Piggy). Flat ledger:
-- + into the pot, − out (a withdrawal also posts a one-off PersonalIncome to a month).
CREATE TABLE "PersonalSavings" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "periodId" INTEGER,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalSavings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonalSavings_memberId_idx" ON "PersonalSavings"("memberId");

ALTER TABLE "PersonalSavings" ADD CONSTRAINT "PersonalSavings_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalSavings" ADD CONSTRAINT "PersonalSavings_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PersonalPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
