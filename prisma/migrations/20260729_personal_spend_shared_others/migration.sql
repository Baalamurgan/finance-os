-- Shared spend: store the portion OTHERS owe, so "your net spend" (amount − sharedOthers)
-- stays correct regardless of repayment status. null = not a shared spend.
ALTER TABLE "PersonalSpend" ADD COLUMN "sharedOthers" DOUBLE PRECISION;
