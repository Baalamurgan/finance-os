-- A manual plan step can be earmarked as a FUNDING move for a specific ExpenseEntry bill
-- (funder → payer): the Money Plan then shrinks the hub's disbursement to that payer by this
-- step's amount and places the move just above the bill. Nullable + additive — existing rows
-- (plain ad-hoc moves) stay valid with fundsExpenseId = NULL.
ALTER TABLE "ManualPlanStep" ADD COLUMN "fundsExpenseId" INTEGER;
