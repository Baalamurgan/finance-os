-- Money Plan: let income arrivals be ticked "received" (strike-through). Display-only flag,
-- nullable, no backfill (existing income rows start un-received).
ALTER TABLE "IncomeEntry" ADD COLUMN "receivedAt" TIMESTAMP(3);
