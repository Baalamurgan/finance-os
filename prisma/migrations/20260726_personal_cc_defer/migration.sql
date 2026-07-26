-- Personal: tag a spend / fixed bill to a credit card (deferred from cash) + settled bill cycles.
ALTER TABLE "PersonalSpend" ADD COLUMN "cardAccountId" INTEGER;
ALTER TABLE "PersonalExpense" ADD COLUMN "cardAccountId" INTEGER;

CREATE TABLE "PersonalCardBill" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "cardAccountId" INTEGER NOT NULL,
    "cycleEnd" TIMESTAMP(3) NOT NULL,
    "paidPeriodId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalCardBill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PersonalCardBill_cardAccountId_cycleEnd_key" ON "PersonalCardBill"("cardAccountId", "cycleEnd");
CREATE INDEX "PersonalCardBill_memberId_idx" ON "PersonalCardBill"("memberId");
CREATE INDEX "PersonalCardBill_paidPeriodId_idx" ON "PersonalCardBill"("paidPeriodId");

ALTER TABLE "PersonalSpend" ADD CONSTRAINT "PersonalSpend_cardAccountId_fkey" FOREIGN KEY ("cardAccountId") REFERENCES "FinanceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonalExpense" ADD CONSTRAINT "PersonalExpense_cardAccountId_fkey" FOREIGN KEY ("cardAccountId") REFERENCES "FinanceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonalCardBill" ADD CONSTRAINT "PersonalCardBill_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalCardBill" ADD CONSTRAINT "PersonalCardBill_cardAccountId_fkey" FOREIGN KEY ("cardAccountId") REFERENCES "FinanceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalCardBill" ADD CONSTRAINT "PersonalCardBill_paidPeriodId_fkey" FOREIGN KEY ("paidPeriodId") REFERENCES "PersonalPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
