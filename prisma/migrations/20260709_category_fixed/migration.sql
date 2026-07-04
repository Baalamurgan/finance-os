-- Fixed monthly bills (subscriptions/EMIs): a recurring Sheet expense tagged to
-- the payer, credited in settlement — distinct from a spend-tracked budget.
ALTER TABLE "Category" ADD COLUMN "fixed" BOOLEAN NOT NULL DEFAULT false;
