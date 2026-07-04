-- Personal wind-down: carry previous month remaining into the next month.
ALTER TABLE "PersonalPeriod" ADD COLUMN "carryForward" DOUBLE PRECISION NOT NULL DEFAULT 0;
