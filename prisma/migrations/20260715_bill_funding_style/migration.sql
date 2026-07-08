-- Goal-based "bill with a fund": fundingStyle (auto|fixed|none) marks a category as a
-- periodic bill funded by its sinking bucket. null = not this mode (unchanged categories).
ALTER TABLE "Category" ADD COLUMN "fundingStyle" TEXT;
