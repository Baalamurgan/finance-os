-- "Full bill on due month" mode for a periodic category: the alternative to a sinking fund.
-- The whole billAmount lands as an expense only in its due month(s) — no monthly share, no
-- fund. billEveryMonths != null marks a category as this mode.
ALTER TABLE "Category" ADD COLUMN "billEveryMonths" INTEGER;
ALTER TABLE "Category" ADD COLUMN "billMonth" INTEGER;
ALTER TABLE "Category" ADD COLUMN "billDay" INTEGER;
ALTER TABLE "Category" ADD COLUMN "billAmount" DOUBLE PRECISION;
