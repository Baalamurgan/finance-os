-- Month-specific "pinned" flag: a Sheet line whose amount/due-day was edited for THIS month.
-- A refresh-from-Setup skips pinned lines so the intentional month override isn't overwritten.
ALTER TABLE "IncomeEntry"  ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ExpenseEntry" ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false;
