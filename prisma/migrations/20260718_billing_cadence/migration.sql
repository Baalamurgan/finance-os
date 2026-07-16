-- Unified billing model: save cadence for auto-funded periodic bills + review flag.
ALTER TABLE "Category" ADD COLUMN "saveEveryMonths" INTEGER;
ALTER TABLE "Category" ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;

-- Existing "full bill on due month" rows (a periodic bill with no fund) become "pay in full".
UPDATE "Category"
   SET "fundingStyle" = 'none'
 WHERE "billEveryMonths" IS NOT NULL AND "fundingStyle" IS NULL AND "sinking" = false;

-- Existing bill-with-a-fund rows keep their behavior: monthly save cadence.
UPDATE "Category"
   SET "saveEveryMonths" = 1
 WHERE "fundingStyle" IN ('auto', 'fixed');

-- Fold rolling sinking funds into the unified periodic-bill model. Due month is unknown for a
-- rolling fund, so anchor it to the current month and flag it for the user to review. The
-- estimated full bill = monthly share × cycle; the fund self-corrects once the real bill lands.
UPDATE "Category"
   SET "billEveryMonths" = COALESCE("cycleMonths", 12),
       "billAmount"      = COALESCE("monthlyBudget", 0) * COALESCE("cycleMonths", 12),
       "billMonth"       = CAST(EXTRACT(MONTH FROM CURRENT_DATE) AS INTEGER),
       "fundingStyle"    = 'auto',
       "saveEveryMonths" = 1,
       "sinking"         = false,
       "tracked"         = false,
       "needsReview"     = true
 WHERE "sinking" = true;
