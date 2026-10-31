-- Base salary can name a target balance account (where it lands) → a "Salary received" plan step credits
-- it on tick. Additive + nullable — existing periods keep salary as a budget-only figure.

-- AlterTable
ALTER TABLE "PersonalPeriod" ADD COLUMN     "incomeAccountId" INTEGER;

-- AddForeignKey
ALTER TABLE "PersonalPeriod" ADD CONSTRAINT "PersonalPeriod_incomeAccountId_fkey" FOREIGN KEY ("incomeAccountId") REFERENCES "FinanceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
