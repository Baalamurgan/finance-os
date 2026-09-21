-- Monthly-recurring spend card: a miscCard that re-seeds its budget every month
-- (a recurring variable budget), as opposed to one-off or yearly.
ALTER TABLE "Category" ADD COLUMN "repeatMonthly" BOOLEAN NOT NULL DEFAULT false;
