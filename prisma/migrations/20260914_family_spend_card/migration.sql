-- Family Cards (Phase 1): a family Spend can be paid with a card (a FinanceAccount) instead of cash/UPI.
-- Null = cash/UPI. When set, the spend is attributed to the card's OWNER. onDelete SET NULL so deleting
-- a card leaves past spends intact (they keep their member attribution; only the card tag is cleared).
ALTER TABLE "Spend" ADD COLUMN IF NOT EXISTS "cardAccountId" INTEGER;

DO $$ BEGIN
  ALTER TABLE "Spend" ADD CONSTRAINT "Spend_cardAccountId_fkey"
    FOREIGN KEY ("cardAccountId") REFERENCES "FinanceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Spend_cardAccountId_idx" ON "Spend"("cardAccountId");
