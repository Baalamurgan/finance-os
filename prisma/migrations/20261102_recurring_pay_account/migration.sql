-- Bank/cash account a recurring bill or spend is paid from (cards keep using cardAccountId). Nullable add-columns only.
ALTER TABLE "PersonalExpense" ADD COLUMN "payAccountId" INTEGER;
ALTER TABLE "PersonalSpend" ADD COLUMN "payAccountId" INTEGER;
