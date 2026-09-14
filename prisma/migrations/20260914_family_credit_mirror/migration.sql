-- Family credit-card spend → mirror line on the card owner's personal credit dashboard.
-- Links an AccountTransaction back to the family Spend that spawned it (1:1), so editing the
-- spend keeps the amount in sync and deleting the spend removes the mirror (ON DELETE CASCADE).

ALTER TABLE "AccountTransaction" ADD COLUMN IF NOT EXISTS "familySpendId" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "AccountTransaction_familySpendId_key"
  ON "AccountTransaction" ("familySpendId");

DO $$ BEGIN
  ALTER TABLE "AccountTransaction"
    ADD CONSTRAINT "AccountTransaction_familySpendId_fkey"
    FOREIGN KEY ("familySpendId") REFERENCES "Spend" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
