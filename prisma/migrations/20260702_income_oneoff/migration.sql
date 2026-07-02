-- One-time income flag (top-ups/loans that must not copy into future months).
ALTER TABLE "IncomeEntry" ADD COLUMN "oneOff" BOOLEAN NOT NULL DEFAULT false;
