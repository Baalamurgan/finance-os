-- "Review Misc" dismissal: mark a genuine misc spend so it stops being suggested for a move.
ALTER TABLE "Spend" ADD COLUMN "reviewIgnored" BOOLEAN NOT NULL DEFAULT false;
