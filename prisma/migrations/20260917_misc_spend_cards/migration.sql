-- Planned-misc spend cards: budgeted (leftover→Piggy) categories created from the Misc add flow.
-- miscCard marks them; repeatYearly (+ billMonth) makes the monthly clone re-seed them yearly.
ALTER TABLE "Category" ADD COLUMN "miscCard" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Category" ADD COLUMN "repeatYearly" BOOLEAN NOT NULL DEFAULT false;
