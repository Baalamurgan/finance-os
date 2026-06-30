-- Add one-off flag to expense entries (wind-down carried misc / over-budget lines
-- that must NOT be copied into future months).
ALTER TABLE "ExpenseEntry" ADD COLUMN "oneOff" BOOLEAN NOT NULL DEFAULT false;
