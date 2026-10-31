-- Personal extra-income can be deposited into a balance account (bank / cash / debit / prepaid); a 1:1
-- mirror ledger line (AccountTransaction.personalIncomeId) raises that account's balance so the money
-- shows up in real life. All adds are nullable, so existing rows stay valid.

-- AlterTable
ALTER TABLE "PersonalIncome" ADD COLUMN     "accountId" INTEGER;

-- AlterTable
ALTER TABLE "AccountTransaction" ADD COLUMN     "personalIncomeId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "AccountTransaction_personalIncomeId_key" ON "AccountTransaction"("personalIncomeId");

-- AddForeignKey
ALTER TABLE "PersonalIncome" ADD CONSTRAINT "PersonalIncome_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinanceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTransaction" ADD CONSTRAINT "AccountTransaction_personalIncomeId_fkey" FOREIGN KEY ("personalIncomeId") REFERENCES "PersonalIncome"("id") ON DELETE CASCADE ON UPDATE CASCADE;
