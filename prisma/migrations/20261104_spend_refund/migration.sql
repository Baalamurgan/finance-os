-- Refunds: one SpendRefund per corrected spend, linking every piece it created (so Undo removes exactly those).
-- Spend.refundOfId marks a refund line (a negative spend) with the original spend it corrects. Additive only.
ALTER TABLE "Spend" ADD COLUMN "refundOfId" INTEGER;
CREATE TABLE "SpendRefund" (
  "id" SERIAL PRIMARY KEY,
  "householdId" INTEGER NOT NULL,
  "spendId" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "budgetTo" TEXT NOT NULL,
  "payWhen" TEXT NOT NULL,
  "periodId" INTEGER NOT NULL,
  "refundSpendId" INTEGER,
  "moveSpendId" INTEGER,
  "incomeId" INTEGER,
  "cardTxnId" INTEGER,
  "stepId" INTEGER,
  "createdById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SpendRefund_spendId_key" ON "SpendRefund"("spendId");
