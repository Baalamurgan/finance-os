-- Phase B1: debit/prepaid card balances + one-ledger for personal balance-card spends.
--   • FinanceAccount.openingBalance — starting balance for debit/prepaid cards (derived balance builds on it).
--   • AccountTransaction.personalSpendId — 1:1 link to a PersonalSpend logged on a debit/prepaid card, so the
--     spend posts to the card ledger; ON DELETE CASCADE keeps the balance in sync when the spend is removed.
-- (The 'prepaid_card' type and 'topup' txn type are string values — no enum/DDL change needed.)

ALTER TABLE "FinanceAccount" ADD COLUMN IF NOT EXISTS "openingBalance" DOUBLE PRECISION DEFAULT 0;

ALTER TABLE "AccountTransaction" ADD COLUMN IF NOT EXISTS "personalSpendId" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "AccountTransaction_personalSpendId_key"
  ON "AccountTransaction" ("personalSpendId");

DO $$ BEGIN
  ALTER TABLE "AccountTransaction"
    ADD CONSTRAINT "AccountTransaction_personalSpendId_fkey"
    FOREIGN KEY ("personalSpendId") REFERENCES "PersonalSpend" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
