-- Family spends: the day the money was spent, picked when logging (additive, nullable; older spends keep
-- using the day they were logged).
ALTER TABLE "Spend" ADD COLUMN "spentOn" TIMESTAMP(3);
