-- AlterTable: early-payment incentive + late penalty for periodic bills (property / water tax).
-- Both nullable → every existing Category stays valid; a tax is a fund bill + these two optionals.
ALTER TABLE "Category" ADD COLUMN "earlyAmount" DOUBLE PRECISION;
ALTER TABLE "Category" ADD COLUMN "latePenaltyPct" DOUBLE PRECISION;
