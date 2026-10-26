-- Recurring Personal setup: income can now carry a date + recur monthly; spends can recur monthly.
-- (Expenses already have `date` + `recurring`.) All adds are defaulted, so existing rows stay valid.

-- AlterTable
ALTER TABLE "PersonalIncome" ADD COLUMN     "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "recurring" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PersonalSpend" ADD COLUMN     "recurring" BOOLEAN NOT NULL DEFAULT false;
