-- Record that a due-month periodic bill was paid, and how it was funded (fund / Piggy /
-- out-of-pocket). One per (category, period) so a paid bill survives draft rebuilds.
CREATE TABLE "BillPayment" (
  "id"          SERIAL PRIMARY KEY,
  "householdId" INTEGER NOT NULL,
  "categoryId"  INTEGER NOT NULL,
  "periodId"    INTEGER NOT NULL,
  "memberId"    INTEGER,
  "fromFund"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fromPiggy"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "outOfPocket" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "paidAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "BillPayment_categoryId_periodId_key" ON "BillPayment"("categoryId", "periodId");
